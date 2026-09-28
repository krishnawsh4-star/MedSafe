import requests

API_URL = "https://api.fda.gov/drug/label.json"

def get_drug_label(drug_name):
    params = {
        "search": f'openfda.generic_name:"{drug_name}"',
        "limit": 1
    }

    response = requests.get(API_URL, params=params, timeout=10)

    if response.status_code != 200:
        return None

    data = response.json()

    if "results" not in data:
        return None

    return data["results"][0]

def get_drug_safety_info(drug_name):
    label = get_drug_label(drug_name)

    if not label:
        return None

    return {
        "drug_name": drug_name,
        "warnings": label.get("warnings", []),
        "contraindications": label.get("contraindications", []),
        "interactions": label.get("drug_interactions", []),
        "dosage": label.get("dosage_and_administration", []),
        "indications": label.get("indications_and_usage", [])
    }

def get_clean_safety_summary(drug_name):
    data = get_drug_safety_info(drug_name)

    if not data:
        return None

    summary = []

    if data["warnings"]:
        warning_text = data["warnings"][0]

        # Long API text ko manageable length mein rakhenge
        short_warning = warning_text[:500]

        summary.append(short_warning)

    if data["contraindications"]:
        summary.append(
            "Contraindications information is available in the drug label."
        )

    if data["interactions"]:
        summary.append(
            "Drug interaction information is available in the drug label."
        )

    if data["dosage"]:
        summary.append(
            "Dosage and administration information is available in the drug label."
        )

    return summary

