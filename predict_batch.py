import sys
import json
import joblib
import pandas as pd
from pathlib import Path

MODEL_DIR      = Path('./models')
ensemble_model = joblib.load(MODEL_DIR / 'ensemble_model.pkl')
scaler         = joblib.load(MODEL_DIR / 'scaler.pkl')
FEATURE_NAMES  = scaler.feature_names_in_.tolist()

def predict_batch(features_list: list) -> list:
    df = pd.DataFrame(features_list, columns=FEATURE_NAMES).fillna(0)
    X_scaled      = scaler.transform(df)
    predictions   = ensemble_model.predict(X_scaled)
    probabilities = ensemble_model.predict_proba(X_scaled)

    return [
        {
            "prediction":    int(pred),
            "confidence":    float(probs[pred]),
            "probabilities": [float(p) for p in probs]
        }
        for pred, probs in zip(predictions, probabilities)
    ]

if __name__ == '__main__':
    try:
        features_list = json.loads(sys.stdin.read())
        print(json.dumps(predict_batch(features_list)))
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)
