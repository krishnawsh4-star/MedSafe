from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from knowledge_base import (
    drug_interactions,
    allergy_database,
    drug_disease_conflicts,
    dosage_rules,
)
from api_client import get_drug_safety_info, get_clean_safety_summary


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
                "reason": "The patient is already taking this medicine."
            })


    # ---------------------------------------------------------
    # 2. DRUG-DRUG INTERACTIONS
    # ---------------------------------------------------------
    for old_medicine in existing:
        for new_medicine in new:

            for interaction in drug_interactions:

                drug_a = interaction["drug_a"].strip().lower()
                drug_b = interaction["drug_b"].strip().lower()

                if (
                    (old_medicine == drug_a and new_medicine == drug_b)
                    or
                    (old_medicine == drug_b and new_medicine == drug_a)
                ):
                    warnings.append({
                        "type": "Drug-Drug Interaction",
                        "medicine": f"{old_medicine} + {new_medicine}",
                        "severity": interaction["severity"],
                        "reason": interaction["reason"]
                    })


    # ---------------------------------------------------------
    # 3. ALLERGY INTERACTIONS
    # ---------------------------------------------------------
    for allergy in allergies:

        for interaction in allergy_database:

            allergen_group = interaction["allergen_group"].strip().lower()

            if allergy == allergen_group:
                warnings.append({
                    "type": "Allergy Interaction",
                    "allergy": allergy,
                    "severity": "Review Required",
                    "reason": interaction["reason"]
                })


    # ---------------------------------------------------------
    # 4. DRUG-DISEASE INTERACTIONS
    # ---------------------------------------------------------
    all_medicines = existing + new

    for medicine in all_medicines:
        for disease in diseases:

            for interaction in drug_disease_conflicts:

                rule_drug = interaction["drug"].strip().lower()
                rule_disease = interaction["disease"].strip().lower()

                if medicine == rule_drug and disease == rule_disease:
                    warnings.append({
                        "type": "Drug-Disease Interaction",
                        "medicine": medicine,
                        "severity": interaction["severity"],
                        "reason": interaction["reason"]
                    })


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
                    "reason": rule["reason"]
                })


    # ---------------------------------------------------------
    # 6. OPENFDA DRUG SAFETY INFORMATION
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
                        "reason": clean_summary[0]
                    })

        except Exception as e:
            print(f"FDA API error for {medicine}: {e}")


    return {
        "warnings": warnings
    }