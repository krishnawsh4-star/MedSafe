from medsafe.backend.knowledge_base import drug_interactions
from medsafe.backend.knowledge_base import allergy_database
from medsafe.backend.knowledge_base import drug_disease_conflicts
from medsafe.backend.knowledge_base import dosage_rules
from medsafe.backend.api_client import get_drug_label
from medsafe.backend.api_client import get_drug_safety_info
from medsafe.backend.api_client import get_clean_safety_summary

# CASE HISTORY 


# taking patient's basic information >


patient_name = str(input("enter patient's name: "))
patient_age = int(input("enter patient's age: "))
patient_weight = float(input("enter patient's weight: "))


# taking patient's exhisting medical conditions >


# medicine_1


exhisting_disease1 = str(input("Is patient diagonised with any disease? "))
medicine_intake = str(input("Is patient taking any medicines? (yes/no) "))
if(medicine_intake.lower() == "yes"):
    medicine_name1 = str(input("enter the name of the first medicine: "))
    medicine_name2 = str(input("enter the exhisting second medicine name: "))
    medicine_name3 = str(input("enter the exhisting third medicine name: "))
else:
    print("NOTED: no exhisting medicine intake!") 
    medicine_name1 = "none"
    medicine_name2 = "none"
    medicine_name3 = "none"   

# checking for allergies


allergy1 = str(input("Any known drug allery/relevent allery? "))
allergy2 = str(input("Any more allergy? "))



# entering patient's new prescription


# new medcine_1


new_medicine_name1 = str(input("enter the first new medicine name: "))
new_medicine_dosage1 = int(input("enter it's dosage: "))
#new_medicine_frequancy1 = str(input("enter the new medicine frequancy: (once a day / twice a day / thrice a day)"))
#new_medicine_route1 = str(input("enter the new medicine route: (oral / injection / etc)"))


# new medcine_2


new_medicine_name2 = str(input("enter the new medicine name: "))
new_medicine_dosage2 = int(input("enter it's dosage: "))
#new_medicine_frequancy2 = str(input("enter the new medicine frequancy: (once a day / twice a day / thrice a day)"))
#new_medicine_route2 = str(input("enter the new medicine route: (oral / injection / etc)"))


# new medcine_3


new_medicine_name3 = str(input("enter the new medicine name: "))
new_medicine_dosage3 = int(input("enter it's dosage: "))
#new_medicine_frequancy3 = str(input("enter the new medicine frequancy: (once a day / twice a day / thrice a day)"))
#new_medicine_route3 = str(input("enter the new medicine route: (oral / injection / etc)"))


# STORE MEDICINES IN LISTS


existing_medicines = [medicine_name1, medicine_name2, medicine_name3]
new_medicines = [new_medicine_name1, new_medicine_name2, new_medicine_name3]
allergies = [allergy1, allergy2]
diseases = [exhisting_disease1]
dosage = [new_medicine_dosage1,new_medicine_dosage2,new_medicine_dosage3]


warnings = []
# API CHECK


for medicine in new_medicines:

    if medicine.strip().lower() in ["no", "none"]:
        continue

    api_data = get_drug_safety_info(medicine)

if api_data:
    print(f"\nAPI data found for: {medicine}")

    clean_summary = get_clean_safety_summary(medicine)

    if clean_summary:
        warnings.append({
            "type": "external-drug-safety",
            "medicine": medicine,
            "severity": "Review Required",
            "reason": clean_summary[0]
        })

else:
    print(f"\nNo API data found for: {medicine}")

# Duplicate Medication Detection


if( medicine_name1 == new_medicine_name1 or medicine_name1 == new_medicine_name2 or medicine_name1 == new_medicine_name3 or medicine_name2 == new_medicine_name3 or medicine_name2 == new_medicine_name2 or medicine_name3 == new_medicine_name3):
    print("same medicine detected!")



# CHECKING DRUG INTERACTIONS


for existing in existing_medicines:
    for new in new_medicines:

        for interaction in drug_interactions:

            if (existing.lower() == interaction["drug_a"].lower()
    and new.lower() == interaction["drug_b"].lower()):

             warnings.append({
        "type": "Drug-Drug Interaction",
        "medicine": existing + " + " + new,
        "severity": interaction["severity"],
        "reason": interaction["reason"]
    })


# CHECKING ALLERGY INTERACTIONS


for allergy in allergies:
    for interaction in allergy_database:

        if allergy.lower() == interaction["allergen_group"].lower():
            warnings.append({
                     "type": "Allergy Interaction",
                     "allergy": allergy,
                     "severity": "Review Required",
                     "reason": interaction["reason"]
            })

# CHECKING DRUG-DISEASE CONFLICT


for exhisting_disease1 in diseases:
    for interaction in drug_disease_conflicts:

        if exhisting_disease1.lower() == interaction["drug"].lower():
           warnings.append({
                  "type": "Drug-Disease Interaction",
                  "medicine": interaction["drug"],
                  "severity": interaction["severity"],
                  "reason": interaction["reason"]
           })
# CHESKING FOR MEDICINE DOSAGE INTERACTIONS

for medicine in new_medicines:
    for rule in dosage_rules:

        if medicine.lower() == rule["drug"].lower():
            warnings.append({
                    "type": "Dosage Review",
                    "medicine": medicine,
                    "severity": "Review Required",
                    "reason": rule["reason"]
            })



print("\n" + "="*40)
print("       MEDICATION SAFETY REPORT")
print("="*40)

print("Patient Name:", patient_name)
print("Age:", patient_age)
print("Weight:", patient_weight, "kg")

print("\n" + "="*30)
print("       WARNINGS DETECTED")
print("="*30)

for warning in warnings:
    print("⚠️", warning["type"])

    if "medicine" in warning:
        print("Medicine:", warning["medicine"])

    if "allergy" in warning:
        print("Allergy:", warning["allergy"])

    print("Severity:", warning["severity"])
    print("Reason:", warning["reason"])
    print()