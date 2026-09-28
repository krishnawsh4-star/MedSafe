
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.knowledge_base import (
    drug_interactions,
    allergy_database,
    drug_disease_conflicts,
    dosage_rules,
)

from backend.api_client import (
    get_drug_safety_info,
    get_clean_safety_summary,
)

from backend import fda_labels


app = FastAPI(title="MedSafe API")


# React frontend ko backend access karne dena
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://medsafe-6e1o.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class NewMedicine(BaseModel):
    name: str
    dosage: float


class Prescription(BaseModel):
    patient_name: str
    age: float
    weight: float
    diseases: list[str] = []
    allergies: list[str] = []
    existing_medicines: list[str] = []
    new_medicines: list[NewMedicine] = []


@app.get("/")
def root():
    return {"message": "MedSafe API is running"}


@app.post("/check-prescription")
def check_prescription(data: Prescription):

    warnings = []

    existing = [
        m.strip().lower()
        for m in data.existing_medicines
        if m.strip()
    ]

    new = [
        m.name.strip().lower()
        for m in data.new_medicines
        if m.name.strip()
    ]

    diseases = [
        d.strip().lower()
        for d in data.diseases
        if d.strip()
    ]

    allergies = [
        a.strip().lower()
        for a in data.allergies
        if a.strip()
    ]


    # ---------------------------------------------------------
    # 1. DUPLICATE MEDICATION
    # ---------------------------------------------------------
    for medicine in new:
        if medicine in existing:
            warnings.append({
                "type": "Duplicate Medication",
                "medicine": medicine,
                "severity": "Review Required",
                "reason": "The patient is already taking this medicine.",
                "danger": "The same medicine is already present in the patient's existing medication list.",
                "source": "MedSafe knowledge base",
            })


    # ---------------------------------------------------------
    # 2. CURATED DRUG-DRUG INTERACTIONS
    # ---------------------------------------------------------
    checked_ddi = set()

    all_pairs = []

    for old_medicine in existing:
        for new_medicine in new:
            all_pairs.append((old_medicine, new_medicine))

    # Also check interactions between two newly prescribed medicines
    for i in range(len(new)):
        for j in range(i + 1, len(new)):
            all_pairs.append((new[i], new[j]))

    for medicine_a, medicine_b in all_pairs:

        pair_key = tuple(sorted([medicine_a, medicine_b]))

        if pair_key in checked_ddi:
            continue

        checked_ddi.add(pair_key)

        found_curated = False

        for interaction in drug_interactions:

            drug_a = interaction["drug_a"].strip().lower()
            drug_b = interaction["drug_b"].strip().lower()

            if (
                (medicine_a == drug_a and medicine_b == drug_b)
                or
                (medicine_a == drug_b and medicine_b == drug_a)
            ):

                warnings.append({
                    "type": "Drug-Drug Interaction",
                    "medicine": f"{medicine_a} + {medicine_b}",
                    "severity": interaction["severity"],
                    "reason": interaction["reason"],
                    "danger": interaction["reason"],
                    "source": "MedSafe knowledge base",
                })

                found_curated = True
                break

        # FDA LABEL FALLBACK
        if not found_curated:

            try:
                evidence = fda_labels.interaction_evidence(
                    medicine_a,
                    medicine_b
                )

                if evidence:
                    warnings.append({
                        "type": "Drug-Drug Interaction",
                        "medicine": f"{medicine_a} + {medicine_b}",
                        "severity": evidence["severity"],
                        "reason": evidence["reason"],
                        "danger": evidence["excerpt"],
                        "source": evidence["source"],
                    })

            except Exception as e:
                print(
                    f"FDA interaction check error for "
                    f"{medicine_a} + {medicine_b}: {e}"
                )


    # ---------------------------------------------------------
    # 3. ALLERGY INTERACTIONS
    # ---------------------------------------------------------
    for allergy in allergies:

        for medicine in new:

            found_curated = False

            for interaction in allergy_database:

                allergen_group = interaction[
                    "allergen_group"
                ].strip().lower()

                if allergy == allergen_group:

                    warnings.append({
                        "type": "Allergy Interaction",
                        "allergy": allergy,
                        "medicine": medicine,
                        "severity": "Review Required",
                        "reason": interaction["reason"],
                        "danger": interaction["reason"],
                        "source": "MedSafe knowledge base",
                    })

                    found_curated = True
                    break

            # FDA allergy check
            try:

                allergy_classes = getattr(
                    __import__(
                        "backend.knowledge_base",
                        fromlist=["allergy_classes"]
                    ),
                    "allergy_classes",
                    {}
                )

                allergy_cross = getattr(
                    __import__(
                        "backend.knowledge_base",
                        fromlist=["allergy_cross_reactivity"]
                    ),
                    "allergy_cross_reactivity",
                    {}
                )

                verdict, evidence = fda_labels.allergy_check(
                    allergy,
                    medicine,
                    allergy_classes,
                    allergy_cross,
                )

                if verdict == "match" and evidence:

                    if not found_curated:

                        warnings.append({
                            "type": "Allergy Interaction",
                            "allergy": allergy,
                            "medicine": medicine,
                            "severity": evidence["severity"],
                            "reason": evidence["reason"],
                            "danger": evidence["reason"],
                            "source": evidence["source"],
                        })

            except Exception as e:
                print(
                    f"FDA allergy check error for "
                    f"{allergy} + {medicine}: {e}"
                )


    # ---------------------------------------------------------
    # 4. DRUG-DISEASE INTERACTIONS
    # ---------------------------------------------------------
    all_medicines = existing + new

    checked_disease = set()

    for medicine in all_medicines:

        for disease in diseases:

            key = (medicine, disease)

            if key in checked_disease:
                continue

            checked_disease.add(key)

            found_curated = False

            for interaction in drug_disease_conflicts:

                rule_drug = interaction["drug"].strip().lower()
                rule_disease = interaction["disease"].strip().lower()

                if medicine == rule_drug and disease == rule_disease:

                    warnings.append({
                        "type": "Drug-Disease Interaction",
                        "medicine": medicine,
                        "severity": interaction["severity"],
                        "reason": interaction["reason"],
                        "danger": interaction["reason"],
                        "source": "MedSafe knowledge base",
                    })

                    found_curated = True
                    break

            # FDA label fallback
            if not found_curated:

                try:
                    evidence = fda_labels.disease_evidence(
                        medicine,
                        disease
                    )

                    if evidence:

                        warnings.append({
                            "type": "Drug-Disease Interaction",
                            "medicine": medicine,
                            "severity": evidence["severity"],
                            "reason": evidence["reason"],
                            "danger": evidence["excerpt"],
                            "source": evidence["source"],
                        })

                except Exception as e:
                    print(
                        f"FDA disease check error for "
                        f"{medicine} + {disease}: {e}"
                    )


    # ---------------------------------------------------------
    # 5. DOSAGE REVIEW
    # ---------------------------------------------------------
    for medicine_data in data.new_medicines:

        medicine = medicine_data.name.strip().lower()

        for rule in dosage_rules:

            if medicine == rule["drug"].strip().lower():

                warnings.append({
                    "type": "Dosage Review",
                    "medicine": medicine_data.name,
                    "severity": "Review Required",
                    "reason": rule["reason"],
                    "danger": rule["reason"],
                    "source": "MedSafe knowledge base",
                })


    # ---------------------------------------------------------
    # 6. OPENFDA GENERAL DRUG SAFETY INFORMATION
    # ---------------------------------------------------------
    for medicine_data in data.new_medicines:

        medicine = medicine_data.name.strip()

        if not medicine:
            continue

        try:

            api_data = get_drug_safety_info(medicine)

            if api_data:

                clean_summary = get_clean_safety_summary(medicine)

                if clean_summary:

                    warnings.append({
                        "type": "external-drug-safety",
                        "medicine": medicine,
                        "severity": "Review Required",
                        "reason": clean_summary[0],
                        "danger": clean_summary[0],
                        "source": "openFDA drug label",
                    })

        except Exception as e:

            print(
                f"FDA API error for {medicine}: {e}"
            )


    # ---------------------------------------------------------
    # REMOVE DUPLICATE WARNINGS
    # ---------------------------------------------------------
    unique_warnings = []
    seen = set()

    for warning in warnings:

        key = (
            warning.get("type"),
            warning.get("medicine"),
            warning.get("allergy"),
            warning.get("reason"),
        )

        if key not in seen:

            seen.add(key)
            unique_warnings.append(warning)


    return {
        "warnings": unique_warnings
    }

