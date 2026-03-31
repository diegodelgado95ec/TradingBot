import joblib
import pandas as pd
import numpy as np
from pathlib import Path

# Cargar modelo y scaler
model  = joblib.load('models/ensemble_model.pkl')
scaler = joblib.load('models/scaler.pkl')

print("=" * 50)
print("🔍 ANÁLISIS DE DATA LEAKAGE")
print("=" * 50)

# 1. Ver tipo de modelo
print(f"\n📦 Tipo de modelo: {type(model).__name__}")

# 2. Si es un pipeline o voting classifier, ver sub-modelos
if hasattr(model, 'estimators_'):
    print(f"📊 Sub-modelos: {[type(e).__name__ for e in model.estimators_]}")

if hasattr(model, 'estimators'):
    print(f"📊 Estimators: {model.estimators}")

# 3. Ver feature names del scaler
print(f"\n✅ Features del scaler ({len(scaler.feature_names_in_)}):")
for f in scaler.feature_names_in_:
    print(f"  - {f}")

# 4. Intentar recuperar metadata de entrenamiento
metadata_path = Path('models/training_metadata.json')
if metadata_path.exists():
    import json
    with open(metadata_path) as f:
        meta = json.load(f)
    print(f"\n📅 Metadata de entrenamiento:")
    print(json.dumps(meta, indent=2))
else:
    print("\n⚠️  No existe training_metadata.json")
    print("    No podemos verificar qué fechas usó el entrenamiento")
    print("    → Necesitas revisar tu script train_model.py")   