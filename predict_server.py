#!/usr/bin/env python3
"""
Servidor de predicciones persistente — lee requests por stdin línea a línea,
responde por stdout línea a línea. Evita re-cargar el modelo en cada chunk.
"""
import sys
import json
import joblib
import pandas as pd
from pathlib import Path

def main():
    MODEL_DIR      = Path('./models')
    ensemble_model = joblib.load(MODEL_DIR / 'ensemble_model.pkl')
    scaler         = joblib.load(MODEL_DIR / 'scaler.pkl')
    FEATURE_NAMES  = scaler.feature_names_in_.tolist()

    # Señal de listo — TypeScript espera esta línea antes de enviar datos
    sys.stdout.write('READY\n')
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line == 'EXIT':
            break

        try:
            features_list = json.loads(line)
            df            = pd.DataFrame(features_list, columns=FEATURE_NAMES).fillna(0)
            X_scaled      = scaler.transform(df)
            predictions   = ensemble_model.predict(X_scaled)
            probs         = ensemble_model.predict_proba(X_scaled)

            results = [
                {
                    "prediction":    int(p),
                    "confidence":    float(pr[p]),
                    "probabilities": [float(x) for x in pr]
                }
                for p, pr in zip(predictions, probs)
            ]
            sys.stdout.write(json.dumps(results) + '\n')
            sys.stdout.flush()

        except Exception as e:
            # Responder con error en la misma línea — nunca romper el loop
            sys.stdout.write(json.dumps({"error": str(e)}) + '\n')
            sys.stdout.flush()

if __name__ == '__main__':
    main()