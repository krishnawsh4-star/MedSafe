drug_interactions = [
    {
        "drug_a": "TEST_DRUG_A",
        "drug_b": "TEST_DRUG_B",
        "type": "drug-drug",
        "severity": "high",
        "reason": "Prototype interaction record"
    },
    {
        "drug_a": "TEST_DRUG_C",
        "drug_b": "TEST_DRUG_D",
        "type": "drug-drug",
        "severity": "moderate",
        "reason": "Prototype interaction record"
    },
    {
        "drug_a": "TEST_DRUG_E",
        "drug_b": "TEST_DRUG_F",
        "type": "drug-drug",
        "severity": "high",
        "reason": "Prototype interaction record"
    },
    {
        "drug_a": "TEST_DRUG_G",
        "drug_b": "TEST_DRUG_H",
        "type": "drug-drug",
        "severity": "high",
        "reason": "Prototype interaction record"
    },
    {
        "drug_a": "TEST_DRUG_I",
        "drug_b": "TEST_DRUG_J",
        "type": "drug-drug",
        "severity": "moderate",
        "reason": "Prototype interaction record"
    },
    {
        "drug_a": "TEST_DRUG_K",
        "drug_b": "TEST_DRUG_L",
        "type": "drug-drug",
        "severity": "high",
        "reason": "Prototype interaction record"
    }
]


allergy_database = [
    {
        "allergen_group": "penicillin",
        "related_drug_class": "beta-lactam",
        "type": "drug-allergy",
        "reason": "Patient has a documented penicillin hypersensitivity; the prescribed drug belongs to a related beta-lactam class."
    },
    {
        "allergen_group": "cephalosporin",
        "related_drug_class": "cephalosporin",
        "type": "drug-allergy",
        "reason": "Patient has a documented hypersensitivity to cephalosporin-class antibiotics."
    },
    {
        "allergen_group": "beta-lactam",
        "related_drug_class": "beta-lactam",
        "type": "drug-allergy",
        "reason": "Patient has a documented beta-lactam hypersensitivity relevant to the prescribed medication."
    }
]

drug_disease_conflicts = [
    {
        "drug": "nadolol",
        "disease": "bronchial asthma",
        "severity": "high",
        "reason": "FDA labeling lists nadolol as contraindicated in bronchial asthma."
    },

    {
        "drug": "nadolol",
        "disease": "overt cardiac failure",
        "severity": "high",
        "reason": "FDA labeling lists nadolol as contraindicated in overt cardiac failure."
    },

    {
        "drug": "piroxicam",
        "disease": "severe heart failure",
        "severity": "high",
        "reason": "FDA labeling advises avoiding piroxicam in severe heart failure unless benefits are expected to outweigh the risk of worsening heart failure."
    },

    {
        "drug": "metformin",
        "disease": "renal impairment",
        "severity": "high",
        "reason": "FDA labeling for a metformin-containing product identifies moderate to severe renal impairment as a contraindication."
    }
]
dosage_rules = [

    {
        "drug": "amoxicillin",
        "review_triggers": [
            "age",
            "body_weight",
            "renal_function"
        ],
        "reason": "FDA prescribing information contains age/weight-dependent dosing and recommends dosage adjustment in relevant renal impairment.",
        "source": "FDA AMOXIL Prescribing Information"
    },

    {
        "drug": "amoxicillin/clavulanate",
        "review_triggers": [
            "age",
            "body_weight",
            "renal_function"
        ],
        "reason": "FDA prescribing information contains different dosing recommendations by patient group and recommends dosage adjustment in severe renal impairment.",
        "source": "FDA AUGMENTIN Prescribing Information"
    },

    {
        "drug": "acetaminophen",
        "review_triggers": [
            "body_weight",
            "age",
            "liver_function",
            "total_daily_exposure"
        ],
        "reason": "FDA prescribing information specifies patient-dependent dosing and warns about dosing errors and excessive total exposure.",
        "source": "FDA Acetaminophen for Injection Prescribing Information"
    }
]