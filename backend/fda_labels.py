"""
fda_labels.py - explanations for ANY medicine, taken from FDA drug labels.

A hand-written knowledge base can never list every interaction, allergy or
drug-disease conflict. So MedSafe now works in two layers:

  1. knowledge_base.py  - your curated records (checked first, always win).
  2. this module        - looks the medicines up in the official FDA drug label
                          (openFDA) and quotes the label's own warning as the
                          "why this is dangerous" text, with its source.

What it can do
  * interaction_evidence(a, b)  - does A's or B's label mention the other drug
                                  (by name or by drug class)?
  * disease_evidence(drug, dz)  - does the drug's label mention the condition
                                  in Contraindications / Warnings / Precautions?
  * allergy_check(allergy, drug, ...) - is the drug the allergen, in the same
                                  class, cross-reactive, or does its label warn
                                  about hypersensitivity to it?

Honest limits
  * Coverage = whatever the FDA label says. If a label does not mention a
    pair, nothing is reported - "no warning" is never a guarantee of safety.
  * openFDA only has US labels. Indian brand names are not there (a few common
    ones are mapped in NAME_ALIASES; add more as needed).
  * Severity is inferred from the label's wording ("contraindicated", "avoid",
    "fatal" ... -> High, otherwise Review Required). A clinician must judge it.

Set OPENFDA_API_KEY (free from open.fda.gov) to raise the rate limit.
"""

import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

API_URL = "https://api.fda.gov/drug/label.json"
API_KEY = os.environ.get("OPENFDA_API_KEY")
TIMEOUT = 8

TTL_FOUND = 24 * 3600   # a label that was found
TTL_MISSING = 3600      # openFDA has no label with that name
TTL_ERROR = 60          # network problem - retry soon


# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------
# UK / Indian generic names and a few common Indian brands -> the US name that
# openFDA uses. Add your own here.
NAME_ALIASES = {
    "paracetamol": "acetaminophen",
    "dolo": "acetaminophen",
    "crocin": "acetaminophen",
    "calpol": "acetaminophen",
    "acetylsalicylic acid": "aspirin",
    "ecosprin": "aspirin",
    "disprin": "aspirin",
    "brufen": "ibuprofen",
    "salbutamol": "albuterol",
    "adrenaline": "epinephrine",
    "noradrenaline": "norepinephrine",
    "frusemide": "furosemide",
    "rifampicin": "rifampin",
    "lignocaine": "lidocaine",
    "pethidine": "meperidine",
    "glibenclamide": "glyburide",
    "amoxycillin": "amoxicillin",
    "ciclosporin": "cyclosporine",
    "cephalexin": "cephalexin",
    "cefalexin": "cephalexin",
    "glyceryl trinitrate": "nitroglycerin",
    "gtn": "nitroglycerin",
    "glycomet": "metformin",
}

_UNITS = re.compile(r"\s*\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu)\b.*$")


def _norm(s):
    """lowercase letters/digits separated by single spaces"""
    return re.sub(r"[^a-z0-9]+", " ", str(s).lower()).strip()


def canonical(name):
    """'Paracetamol 500 mg' -> 'acetaminophen'"""
    n = re.sub(r"\s+", " ", str(name).strip().lower())
    n = _UNITS.sub("", n).strip()
    return NAME_ALIASES.get(n, n)


def _word_re(term):
    """whole-word regex for a lowercase term (allows a plural s/es)"""
    return re.compile(r"(?<![a-z0-9])" + re.escape(term.lower()) + r"(?:s|es)?(?![a-z0-9])")


# ---------------------------------------------------------------------------
# Label sections we read
# ---------------------------------------------------------------------------
# key in the openFDA label -> (name shown to the user, weight)
SECTIONS = {
    "contraindications": ("Contraindications", 3),
    "boxed_warning": ("Boxed warning", 3),
    "drug_interactions": ("Drug interactions", 2),
    "warnings_and_cautions": ("Warnings and precautions", 1),
    "warnings": ("Warnings", 1),
    "precautions": ("Precautions", 1),
    "use_in_specific_populations": ("Use in specific populations", 1),
}
DDI_SECTIONS = ["contraindications", "boxed_warning", "drug_interactions",
                "warnings_and_cautions", "warnings", "precautions"]
DISEASE_SECTIONS = ["contraindications", "boxed_warning", "warnings_and_cautions",
                    "warnings", "precautions", "use_in_specific_populations"]
ALLERGY_SECTIONS = ["contraindications", "boxed_warning", "warnings_and_cautions",
                    "warnings", "precautions"]
# matching by drug CLASS is noisier, so it is only trusted in these sections
CLASS_SECTIONS = {"contraindications", "boxed_warning", "drug_interactions"}


# ---------------------------------------------------------------------------
# Reading label text
# ---------------------------------------------------------------------------
_HEAD_WORDS = re.compile(
    r"\b(?:DRUG INTERACTIONS|CONTRAINDICATIONS|WARNINGS AND PRECAUTIONS|WARNINGS|PRECAUTIONS|"
    r"BOXED WARNING|USE IN SPECIFIC POPULATIONS|WARNING)\b:?"
)
_SUBNUM = re.compile(r"\b\d{1,2}\.\d{1,2}(?:\.\d{1,2})*\s+")
_LEADNUM = re.compile(r"(?:(?<=\s)|^)\d{1,2}\s+(?=[A-Z]{3,}\b)")
_SPLIT = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9(“"])')

# wording that says "this is serious"
_STRONG = re.compile(
    r"contraindicat|\bavoid|do not (?:use|administer|co-?administer)|should not|not recommended|"
    r"life[- ]threatening|\bfatal|serious|severe|boxed",
    re.I,
)
# wording that says "this is fine" - such sentences are never reported
_REASSURE = re.compile(
    r"no (?:dos(?:e|age) )?(?:adjustment|change)s?\b|not (?:required|necessary|needed)\b|"
    r"no (?:clinically )?(?:significant|relevant|meaningful)\b|did not (?:alter|affect|change|differ)|"
    r"does not (?:alter|affect)|no (?:pharmacokinetic )?interaction",
    re.I,
)
_HYPERSENS = re.compile(r"hypersensitiv|allerg|anaphyla", re.I)


def _sentences(raw_text):
    text = re.sub(r"\s+", " ", raw_text or "")
    text = _HEAD_WORDS.sub(" ", text)
    text = _SUBNUM.sub("", text)
    text = _LEADNUM.sub("", text)
    parts = _SPLIT.split(text.strip())
    return [p.strip() for p in parts if len(p.strip()) > 20]


def _excerpt(sents, i, limit=460):
    """the matching sentence (plus the next one if it is short), trimmed"""
    out = sents[i]
    if len(out) < 170 and i + 1 < len(sents) and not _REASSURE.search(sents[i + 1]):
        out = f"{out} {sents[i + 1]}"
    if len(out) > limit:
        cut = out[:limit]
        end = max(cut.rfind(". "), cut.rfind("; "))
        out = cut[: end + 1] if end > limit * 0.5 else cut.rsplit(" ", 1)[0] + "…"
    return out


_TAG = re.compile(r"\s*\[[^\]]*\]\s*$")


class Label:
    """one openFDA label plus a few helpers"""

    def __init__(self, raw):
        self.raw = raw
        self.openfda = raw.get("openfda") or {}
        self.classes = []  # (normalised class name, display name)
        for field in ("pharm_class_epc", "pharm_class_moa", "pharm_class_cs"):
            for v in self.openfda.get(field) or []:
                base = _norm(_TAG.sub("", v))
                if len(base) >= 6:
                    self.classes.append((base, _TAG.sub("", v).strip()))
        self._sent_cache = {}

    def sentences(self, key):
        if key not in self._sent_cache:
            v = self.raw.get(key) or []
            text = " ".join(v) if isinstance(v, list) else str(v)
            self._sent_cache[key] = _sentences(text)
        return self._sent_cache[key]


def names_for(label, key):
    """every name a medicine goes by (typed name, generic, brand, active substance)"""
    names = {key}
    if label:
        of = label.openfda
        for field in ("generic_name", "substance_name"):
            for v in (of.get(field) or [])[:6]:
                v = v.lower().strip()
                names.add(v)
                first = re.sub(r"[^a-z0-9\-]+", " ", v).split()
                if first and len(first[0]) >= 5:  # 'amlodipine besylate' -> 'amlodipine'
                    names.add(first[0])
        for v in (of.get("brand_name") or [])[:6]:
            names.add(v.lower().strip())
    return sorted({n for n in names if len(n) >= 4}, key=len, reverse=True)


# ---------------------------------------------------------------------------
# Fetching labels from openFDA (cached, parallel)
# ---------------------------------------------------------------------------
def _http_search(query):
    params = {"search": query, "limit": 5}
    if API_KEY:
        params["api_key"] = API_KEY
    resp = requests.get(API_URL, params=params, timeout=TIMEOUT)
    if resp.status_code == 404:  # openFDA answers 404 when nothing matches
        return []
    resp.raise_for_status()
    return resp.json().get("results", [])


_search = _http_search  # tests replace this


def _query_for(name):
    safe = re.sub(r"[^a-z0-9 \-]", " ", name).strip()
    return (f'openfda.generic_name:"{safe}" OR openfda.substance_name:"{safe}" '
            f'OR openfda.brand_name:"{safe}"')


def _completeness(raw):
    total = 0
    for k in SECTIONS:
        v = raw.get(k)
        if isinstance(v, list):
            total += len(" ".join(v))
    return total


def _pick_best(results, name):
    """Prefer a label for exactly this drug, then the most complete one
    (repackager labels often have truncated sections)."""
    n = _norm(name)

    def key(raw):
        generics = [_norm(g) for g in (raw.get("openfda") or {}).get("generic_name", [])]
        exact = any(g == n or g.startswith(n + " ") for g in generics)
        return (exact, _completeness(raw))

    return max(results, key=key)


_cache = {}
_lock = threading.Lock()


def fetch_label(name):
    """-> (Label or None, status)   status: 'ok' | 'missing' | 'error'"""
    key = canonical(name)
    if not key:
        return None, "missing"
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1], hit[2]

    candidates = [key]
    first = re.split(r"\s*(?:/|\+|,| and )\s*", key)[0]
    if first and first != key:
        candidates.append(first)

    label, status, ttl = None, "missing", TTL_MISSING
    try:
        for cand in candidates:
            results = _search(_query_for(cand))
            if results:
                label, status, ttl = Label(_pick_best(results, cand)), "ok", TTL_FOUND
                break
    except Exception:
        label, status, ttl = None, "error", TTL_ERROR

    with _lock:
        _cache[key] = (now + ttl, label, status)
    return label, status


def prefetch(names):
    """Look up all medicines at once so a check takes one round-trip, not N."""
    unique = sorted({canonical(n) for n in names if str(n).strip()})
    if not unique:
        return
    with ThreadPoolExecutor(max_workers=min(8, len(unique))) as pool:
        list(pool.map(fetch_label, unique))


# ---------------------------------------------------------------------------
# Drug CLASS matching (so "ibuprofen" is found when a label says "NSAIDs")
# ---------------------------------------------------------------------------
# (part of an FDA class name, extra patterns for how labels write that class)
CLASS_SYNONYMS = [
    ("nonsteroidal anti inflammatory", [r"\bnsaids?\b", r"non ?steroidal anti inflammatory"]),
    ("angiotensin converting enzyme inhibitor", [r"\bace inhibitors?\b", r"angiotensin converting enzyme inhibitors?"]),
    ("angiotensin 2 receptor", [r"\barbs?\b", r"angiotensin (?:ii |2 )?receptor (?:blockers?|antagonists?)"]),
    ("hydroxymethylglutaryl", [r"\bstatins?\b", r"hmg coa reductase inhibitors?"]),
    ("hmg coa reductase", [r"\bstatins?\b", r"hmg coa reductase inhibitors?"]),
    ("beta adrenergic blocker", [r"beta (?:adrenergic )?(?:receptor )?(?:blocking agents?|blockers?|antagonists?)"]),
    ("aldosterone antagonist", [r"potassium sparing", r"aldosterone antagonists?"]),
    ("vitamin k antagonist", [r"\banticoagulants?\b", r"coumarin"]),
    ("platelet aggregation inhibitor", [r"\bantiplatelet", r"platelet aggregation inhibitors?"]),
    ("nitrate", [r"\bnitrates?\b", r"organic nitrates?"]),
    ("phosphodiesterase 5", [r"\bpde5 inhibitors?\b", r"phosphodiesterase (?:type )?5 inhibitors?"]),
    ("selective serotonin reuptake", [r"\bssris?\b"]),
    ("monoamine oxidase inhibitor", [r"\bmaois?\b"]),
    ("proton pump inhibitor", [r"\bppis?\b"]),
    ("azole antifungal", [r"azole antifungals?"]),
    ("quinolone", [r"fluoroquinolones?", r"quinolones?"]),
    ("opioid", [r"\bopioids?\b", r"opiate"]),
    ("central nervous system depressant", [r"cns depressants?", r"central nervous system depressants?"]),
    ("sulfonylurea", [r"sulfonylureas?"]),
    ("loop diuretic", [r"loop diuretics?"]),
    ("thiazide", [r"thiazides?", r"thiazide diuretics?"]),
]


def _class_regexes(base):
    toks = base.split()
    last = toks[-1]
    tail = r"(?:drug|agent)s?" if last in ("drug", "agent") else re.escape(last) + r"s?"
    body = r"\s".join(re.escape(t) for t in toks[:-1])
    pats = [re.compile(r"(?<![a-z0-9])" + (body + r"\s" if body else "") + tail + r"(?![a-z0-9])")]
    for part, extras in CLASS_SYNONYMS:
        if part in base:
            pats += [re.compile(e) for e in extras]
    m = re.match(r"cytochrome p450 (\w+) (inhibitor|inducer)", base)
    if m:
        pats.append(re.compile(rf"(?<![a-z0-9])cyp ?{m.group(1)} {m.group(2)}s?(?![a-z0-9])"))
    return pats


def _class_matchers(other, src):
    """patterns for other's classes, minus classes both drugs share
    (otherwise a label's general 'NSAIDs can ...' warning would match every NSAID pair)"""
    if not other:
        return []
    shared = {b for b, _ in src.classes} if src else set()
    out = []
    for base, display in other.classes:
        if base in shared:
            continue
        out += [(rx, display) for rx in _class_regexes(base)]
    return out


# ---------------------------------------------------------------------------
# 1. Drug-drug interactions
# ---------------------------------------------------------------------------
def _scan_interaction(src, src_name, other, other_name):
    onames = names_for(other, canonical(other_name))
    name_rx = [(n, _word_re(n)) for n in onames]
    class_rx = _class_matchers(other, src)
    best = None
    for key in DDI_SECTIONS:
        section_name, weight = SECTIONS[key]
        sents = src.sentences(key)
        for i, sent in enumerate(sents):
            if _REASSURE.search(sent):
                continue
            low = sent.lower()
            hit = next((("name", n) for n, rx in name_rx if rx.search(low)), None)
            if not hit and key in CLASS_SECTIONS:
                nsent = _norm(sent)
                hit = next((("class", disp) for rx, disp in class_rx if rx.search(nsent)), None)
            if not hit:
                continue
            strong = bool(_STRONG.search(sent))
            score = weight * 10 + (5 if strong else 0) + (3 if hit[0] == "name" else 0)
            if best is None or score > best["score"]:
                best = {
                    "score": score,
                    "severity": "High" if (strong or weight == 3) else "Review Required",
                    "section": section_name,
                    "excerpt": _excerpt(sents, i),
                    "how": hit[0],
                    "matched": hit[1],
                    "label_of": src_name,
                    "other": other_name,
                }
    return best


def interaction_evidence(a, b):
    """Best label evidence that a and b interact, or None."""
    la, _ = fetch_label(a)
    lb, _ = fetch_label(b)
    best = None
    for src, src_name, other, other_name in ((la, a, lb, b), (lb, b, la, a)):
        if not src:
            continue
        found = _scan_interaction(src, src_name, other, other_name)
        if found and (best is None or found["score"] > best["score"]):
            best = found
    if not best:
        return None
    if best["how"] == "name":
        best["reason"] = f"The FDA label for {best['label_of']} mentions {best['other']} in its {best['section']} section."
    else:
        best["reason"] = (f"{best['other']} is a {best['matched']} (FDA classification), and the FDA label for "
                          f"{best['label_of']} warns about that group in its {best['section']} section.")
    best["source"] = f"FDA drug label for {best['label_of']} - {best['section']}"
    return best


# ---------------------------------------------------------------------------
# 2. Drug-disease conflicts
# ---------------------------------------------------------------------------
# (pattern for what the doctor typed, wording labels use for that condition)
DISEASE_TERMS = [
    (r"kidney|renal|nephr|\bckd\b|dialysis", ["renal impairment", "renal insufficiency", "renal failure", "renal disease", "renal dysfunction", "kidney disease", "kidney impairment", "kidney failure", "kidney problems", "impaired renal function"]),
    (r"heart failure|cardiac failure|\bchf\b|cardiomyopathy", ["heart failure", "cardiac failure", "congestive heart failure", "cardiomyopathy"]),
    (r"liver|hepat|cirrhosis|jaundice", ["hepatic impairment", "hepatic insufficiency", "hepatic failure", "hepatic disease", "liver disease", "liver impairment", "liver failure", "cirrhosis", "impaired hepatic function"]),
    (r"asthma|wheez|bronchospasm", ["asthma", "bronchial asthma", "bronchospasm"]),
    (r"copd|chronic obstructive|emphysema|bronchitis", ["chronic obstructive pulmonary disease", "copd", "emphysema", "bronchospastic disease"]),
    (r"diabet", ["diabetes", "diabetes mellitus", "diabetic"]),
    (r"hypertens|blood pressure", ["hypertension", "uncontrolled hypertension", "severe hypertension"]),
    (r"hypotens", ["hypotension"]),
    (r"ulcer|gastritis|gerd|gi bleed|gastrointestinal bleed|acid reflux", ["peptic ulcer", "gastric ulcer", "gastrointestinal bleeding", "gastrointestinal ulceration", "ulcer"]),
    (r"epilep|seizure|convuls", ["seizure", "epilepsy", "convulsions"]),
    (r"glaucoma", ["glaucoma", "angle closure glaucoma"]),
    (r"prostat|bph|urinary retention|urinary obstruction", ["benign prostatic hyperplasia", "urinary retention", "prostatic hypertrophy", "bladder outlet obstruction"]),
    (r"thyroid", ["hyperthyroidism", "hypothyroidism", "thyroid disease"]),
    (r"pregnan", ["pregnancy", "pregnant women", "fetal harm", "fetal toxicity"]),
    (r"breast ?feed|lactat", ["lactation", "breastfeeding", "nursing mothers"]),
    (r"coronary|angina|myocardial|heart attack|ischemic heart", ["coronary artery disease", "myocardial infarction", "angina", "ischemic heart disease", "cardiovascular disease"]),
    (r"arrhythm|\bqt\b|palpitation|atrial|heart block|bradycardia", ["arrhythmia", "qt prolongation", "torsades de pointes", "heart block", "bradycardia", "atrial fibrillation"]),
    (r"gout|uric", ["gout", "hyperuricemia"]),
    (r"bleed|hemophilia|haemophilia|thrombocytopeni|coagulopathy", ["bleeding disorder", "hemophilia", "thrombocytopenia", "active bleeding", "coagulopathy"]),
    (r"anemi|anaemi", ["anemia", "aplastic anemia"]),
    (r"depress|suicid", ["depression", "suicidal"]),
    (r"hyperkal|potassium", ["hyperkalemia"]),
    (r"tubercul|\btb\b", ["tuberculosis"]),
    (r"\bhiv\b", ["hiv"]),
    (r"porphyri", ["porphyria"]),
    (r"myasthenia", ["myasthenia gravis"]),
    (r"parkinson", ["parkinson"]),
    (r"osteopor", ["osteoporosis"]),
]


def disease_terms(disease):
    d = _norm(disease)
    terms = set()
    for rx, words in DISEASE_TERMS:
        if re.search(rx, d):
            terms.update(words)
    if len(d) >= 4:
        terms.add(d)
    return sorted(terms, key=len, reverse=True)


def disease_evidence(drug, disease):
    """Label evidence that `drug` is a problem for `disease`, or None."""
    label, _ = fetch_label(drug)
    if not label:
        return None
    term_rx = [(t, re.compile(r"(?<![a-z0-9])" + re.escape(_norm(t)) + r"(?:s|es)?(?![a-z0-9])"))
               for t in disease_terms(disease)]
    best = None
    for key in DISEASE_SECTIONS:
        section_name, weight = SECTIONS[key]
        sents = label.sentences(key)
        for i, sent in enumerate(sents):
            if _REASSURE.search(sent):
                continue
            nsent = _norm(sent)
            hit = next((t for t, rx in term_rx if rx.search(nsent)), None)
            if not hit:
                continue
            strong = bool(_STRONG.search(sent))
            score = weight * 10 + (5 if strong else 0)
            if best is None or score > best["score"]:
                best = {
                    "score": score,
                    "severity": "High" if (strong or weight == 3) else "Review Required",
                    "section": section_name,
                    "excerpt": _excerpt(sents, i),
                }
    if not best:
        return None
    best["reason"] = f"The FDA label for {drug} mentions {disease} in its {best['section']} section."
    best["source"] = f"FDA drug label for {drug} - {best['section']}"
    return best


# ---------------------------------------------------------------------------
# 3. Allergies
# ---------------------------------------------------------------------------
ALLERGEN_ALIASES = {
    "penicillins": "penicillin",
    "cephalosporins": "cephalosporin",
    "beta lactam": "beta-lactam",
    "beta lactams": "beta-lactam",
    "betalactam": "beta-lactam",
    "sulfa": "sulfonamide",
    "sulpha": "sulfonamide",
    "sulfonamides": "sulfonamide",
    "sulfa drugs": "sulfonamide",
    "nsaids": "nsaid",
    "nsaid": "nsaid",
    "non steroidal anti inflammatory": "nsaid",
    "nonsteroidal anti inflammatory": "nsaid",
    "macrolides": "macrolide",
    "quinolone": "fluoroquinolone",
    "quinolones": "fluoroquinolone",
    "fluoroquinolones": "fluoroquinolone",
    "tetracyclines": "tetracycline",
    "carbapenems": "carbapenem",
}
_FILLER = re.compile(r"\b(?:allergy|allergic|allergies|hypersensitivity|reaction|reactions|to|of|history|"
                     r"drugs?|medicines?|medications?|antibiotics?)\b")

# how an FDA class name reads for each allergen group (matched on the class text)
ALLERGEN_CLASS_TERMS = {
    "penicillin": [r"penicillin"],
    "cephalosporin": [r"cephalosporin"],
    "carbapenem": [r"carbapenem"],
    "beta-lactam": [r"beta lactam", r"penicillin", r"cephalosporin", r"carbapenem"],
    "sulfonamide": [r"sulfonamide"],
    "nsaid": [r"nonsteroidal anti inflammatory", r"non steroidal anti inflammatory"],
    "macrolide": [r"macrolide"],
    "fluoroquinolone": [r"quinolone"],
    "tetracycline": [r"tetracycline"],
}
# how labels WRITE each allergen group in their text
ALLERGEN_TEXT_TERMS = {
    "beta-lactam": ["beta-lactam", "penicillin", "cephalosporin"],
    "sulfonamide": ["sulfonamide", "sulfa"],
    "nsaid": ["nsaid", "non-steroidal anti-inflammatory", "nonsteroidal anti-inflammatory"],
    "fluoroquinolone": ["fluoroquinolone", "quinolone"],
}
# FDA-class matches are only called High for groups where the class is a clear fit
_STRICT_CLASSES = {"penicillin", "cephalosporin", "carbapenem", "beta-lactam", "nsaid",
                   "macrolide", "fluoroquinolone", "tetracycline"}


def allergen_key(text):
    n = _norm(text)
    stripped = re.sub(r"\s+", " ", _FILLER.sub(" ", n)).strip() or n
    return ALLERGEN_ALIASES.get(stripped, canonical(stripped))


def _in_list(dkey, dnames, members):
    members = members or []
    return any(m == dkey or m in dnames for m in (canonical(x) for x in members))


def _fda_class_hit(label, key):
    terms = ALLERGEN_CLASS_TERMS.get(key)
    if not label or not terms:
        return None
    for base, display in label.classes:
        if any(re.search(t, base) for t in terms):
            return display
    return None


def _allergy_text_evidence(label, key):
    terms = ALLERGEN_TEXT_TERMS.get(key, [key])
    rx = [_word_re(t) for t in terms]
    best = None
    for section in ALLERGY_SECTIONS:
        section_name, weight = SECTIONS[section]
        sents = label.sentences(section)
        for i, sent in enumerate(sents):
            if _REASSURE.search(sent) or not _HYPERSENS.search(sent):
                continue
            low = sent.lower()
            if any(r.search(low) for r in rx) and (best is None or weight > best["weight"]):
                best = {"weight": weight, "section": section_name, "excerpt": _excerpt(sents, i)}
    return best


def allergy_check(allergy, drug, classes, cross):
    """
    Is `drug` a problem for a patient allergic to `allergy`?

    classes: {allergen group: [drug names]}   (knowledge_base.allergy_classes)
    cross:   {allergen group: [other groups it can cross-react with]}

    Returns (verdict, info)
      ("match",   {"severity", "reason", "source"})
      ("unknown", None)  the allergy is a drug/drug group but the medicine could
                         not be looked up, so MedSafe cannot say either way
      ("none",    None)  no connection found (or the "allergy" is not a drug at all)
    """
    akey = allergen_key(allergy)
    dkey = canonical(drug)
    is_group = akey in classes or akey in ALLERGEN_CLASS_TERMS

    if not is_group:
        allergen_label, _ = fetch_label(akey)
        if allergen_label is None:  # dust, peanuts, latex... nothing to compare
            return "none", None

    label, _status = fetch_label(dkey)
    dnames = names_for(label, dkey)

    # 1. the very same medicine
    if not is_group and (dkey == akey or akey in dnames):
        return "match", {
            "severity": "High",
            "reason": f"The patient is allergic to {allergy}, and {drug} is that medicine.",
            "source": "The patient's recorded allergy is to this exact medicine.",
        }

    # 2. same group, from MedSafe's own list
    if is_group and _in_list(dkey, dnames, classes.get(akey)):
        return "match", {
            "severity": "High",
            "reason": f"{drug} belongs to the {akey} group, which matches the patient's {allergy} allergy.",
            "source": f"MedSafe {akey} group list",
        }

    # 3. same group, from the FDA's own drug classification
    fda_class = _fda_class_hit(label, akey)
    if fda_class:
        return "match", {
            "severity": "High" if akey in _STRICT_CLASSES else "Review Required",
            "reason": f"{drug} belongs to the {akey} group, which matches the patient's {allergy} allergy.",
            "source": f"FDA drug class: {fda_class}",
        }

    # 4. a related group people can cross-react with
    for ckey in cross.get(akey, []):
        if _in_list(dkey, dnames, classes.get(ckey)) or _fda_class_hit(label, ckey):
            return "match", {
                "severity": "Review Required",
                "reason": (f"{drug} is a {ckey} medicine. People allergic to {allergy} can sometimes "
                           f"react to {ckey} medicines too (cross-reactivity)."),
                "source": f"Known cross-reactivity between {akey} and {ckey} medicines",
            }

    # 5. the medicine's own label warns about this allergy
    if label:
        found = _allergy_text_evidence(label, akey)
        if found:
            return "match", {
                "severity": "High" if found["weight"] == 3 else "Review Required",
                "reason": f"The FDA label for {drug} warns about hypersensitivity involving {allergy}.",
                "source": f"FDA drug label for {drug} - {found['section']}: \u201c{found['excerpt']}\u201d",
            }
        return "none", None

    return "unknown", None
