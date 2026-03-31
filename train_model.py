import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
from sklearn.utils.class_weight import compute_class_weight
import lightgbm as lgb
import xgboost as xgb
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from imblearn.under_sampling import RandomUnderSampler
from sklearn.utils import resample
import joblib
import os
import json
from datetime import datetime

print("🚀 ENTRENAMIENTO DE MODELO ML\n")

# ══════════════════════════════════════════════
# 1. CARGAR Y CONCATENAR DATOS
# ══════════════════════════════════════════════
symbols = ['frxeurusd', 'frxgbpusd', 'frxusdjpy', 'frxgbpjpy', 'frxaudusd']
all_data = []

for symbol in symbols:
    filepath = f'ml_data/{symbol}_features.csv'
    if os.path.exists(filepath):
        df_sym = pd.read_csv(filepath)
        df_sym['symbol'] = symbol
        all_data.append(df_sym)
        print(f"✅ {symbol}: {len(df_sym):,} filas")

df = pd.concat(all_data, ignore_index=True)
df = df.dropna()
df = df.sort_values('epoch').reset_index(drop=True)  # ← orden temporal ANTES del balanceo

print(f"\n📊 Total cargado: {len(df):,} filas")

# ══════════════════════════════════════════════
# 2. NORMALIZAR TARGET → 0/1/2 (consistente con predict_batch)
#    CSV usa -1/0/1 → convertir a 0/1/2
#    -1 (DOWN) → 0 | 0 (NEUTRAL) → 1 | 1 (UP) → 2
# ══════════════════════════════════════════════
df['target'] = df['target'].map({-1: 0, 0: 1, 1: 2})

print(f"\n📊 Distribución original:")
print(df['target'].value_counts(normalize=True).rename({0:'DOWN', 1:'NEUTRAL', 2:'UP'}).sort_index())

# ══════════════════════════════════════════════
# 3. FEATURES
# ══════════════════════════════════════════════
FEATURE_NAMES = [
    'open', 'high', 'low', 'close',
    'rsi', 'macd', 'macdSignal', 'macdHistogram',
    'bbUpper', 'bbMiddle', 'bbLower',
    'ema9', 'ema21', 'ema50', 'stochK', 'stochD', 'atr',
    'close_lag1', 'close_lag2', 'close_lag3',
    'rsi_lag1', 'rsi_lag2', 'volume_change',
    'price_change_1', 'price_change_3', 'price_change_5',
    'close_sma_5', 'close_sma_10', 'close_sma_20',
    'close_std_5', 'close_std_10',
    'high_low_ratio', 'close_to_ema9_ratio', 'close_to_ema21_ratio',
    'rsi_momentum', 'macd_momentum', 'bb_position', 'stoch_momentum'
]

# Verificar que todas las columnas existen
missing = [f for f in FEATURE_NAMES if f not in df.columns]
if missing:
    raise ValueError(f"❌ Features faltantes en CSV: {missing}")

X = df[FEATURE_NAMES].fillna(0)
y = df['target']

# ══════════════════════════════════════════════
# 4. SPLIT TEMPORAL — sin leakage
#    Train: 2020-2023 | Test: 2024-2025
# ══════════════════════════════════════════════
SPLIT_DATE = int(pd.Timestamp('2024-01-01').timestamp())

train_mask = df['epoch'] < SPLIT_DATE
test_mask  = df['epoch'] >= SPLIT_DATE

X_train, X_test = X[train_mask].copy(), X[test_mask].copy()
y_train, y_test = y[train_mask].copy(), y[test_mask].copy()

print(f"\n📅 Train: {len(X_train):,} filas (2020-2023)")
print(f"📅 Test:  {len(X_test):,}  filas (2024-2025)")

# ══════════════════════════════════════════════
# 5. SCALER — fit SOLO en train
# ══════════════════════════════════════════════
scaler         = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)   # ← fit aquí
X_test_scaled  = scaler.transform(X_test)         # ← solo transform

# ══════════════════════════════════════════════
# 6. UNDERSAMPLE NEUTRAL (clase 1) en train
#    Target: DOWN ≈ UP ≈ n_minority, NEUTRAL = 150% de n_minority
# ══════════════════════════════════════════════
n_down      = int(sum(y_train == 0))
n_up        = int(sum(y_train == 2))
n_neutral   = int(sum(y_train == 1))
n_minority  = min(n_down, n_up)
n_neutral_target = int(n_minority * 1.5)

print(f"\n⚖️  Antes:  DOWN={n_down:,} | NEUTRAL={n_neutral:,} | UP={n_up:,}")
print(f"⚖️  Target NEUTRAL: {n_neutral_target:,}")

rus = RandomUnderSampler(
    sampling_strategy={1: n_neutral_target},  # ← solo reducir clase 1 (NEUTRAL)
    random_state=42
)
X_train_bal, y_train_bal = rus.fit_resample(X_train_scaled, y_train)

print(f"\n✅ Dataset balanceado: {len(X_train_bal):,} filas")
print("📊 Nueva distribución:")
dist = pd.Series(y_train_bal).value_counts(normalize=True).rename({0:'DOWN', 1:'NEUTRAL', 2:'UP'})
print(dist.sort_index())

# Class weights para modelos que lo soporten
class_weights_arr = compute_class_weight('balanced', classes=np.unique(y_train_bal), y=y_train_bal)
class_weight_dict = {int(k): float(v) for k, v in zip(np.unique(y_train_bal), class_weights_arr)}
print(f"\n⚖️  Class weights: {class_weight_dict}\n")

# ══════════════════════════════════════════════
# 7. ENTRENAR MODELOS
# ══════════════════════════════════════════════

# ── LightGBM ──────────────────────────────────
print("🔵 Entrenando LightGBM...")
lgb_model = lgb.LGBMClassifier(
    objective='multiclass',
    num_class=3,
    n_estimators=500,
    learning_rate=0.05,
    max_depth=7,
    num_leaves=31,
    min_child_samples=20,
    subsample=0.8,
    colsample_bytree=0.8,
    class_weight=class_weight_dict,
    random_state=42,
    verbose=-1
)
lgb_model.fit(X_train_bal, y_train_bal)
lgb_pred = lgb_model.predict(X_test_scaled)
lgb_acc  = accuracy_score(y_test, lgb_pred)
print(f"✅ LightGBM Accuracy: {lgb_acc:.4f}\n")

# ── XGBoost ───────────────────────────────────
print("🔵 Entrenando XGBoost...")
sample_weights_xgb = np.array([class_weight_dict[int(yi)] for yi in y_train_bal])
xgb_model = xgb.XGBClassifier(
    objective='multi:softprob',   # ← softprob para predict_proba en VotingClassifier
    num_class=3,
    n_estimators=500,
    learning_rate=0.05,
    max_depth=7,
    subsample=0.8,
    colsample_bytree=0.8,
    random_state=42,
    eval_metric='mlogloss',
    verbosity=0
)
xgb_model.fit(X_train_bal, y_train_bal, sample_weight=sample_weights_xgb)
xgb_pred = xgb_model.predict(X_test_scaled)
xgb_acc  = accuracy_score(y_test, xgb_pred)
print(f"✅ XGBoost Accuracy: {xgb_acc:.4f}\n")

# ── Random Forest ─────────────────────────────
print("🔵 Entrenando Random Forest...")
rf_model = RandomForestClassifier(
    n_estimators=300,
    max_depth=15,
    min_samples_split=10,
    min_samples_leaf=5,
    class_weight='balanced',
    random_state=42,
    n_jobs=-1
)
rf_model.fit(X_train_bal, y_train_bal)
rf_pred = rf_model.predict(X_test_scaled)
rf_acc  = accuracy_score(y_test, rf_pred)
print(f"✅ Random Forest Accuracy: {rf_acc:.4f}\n")

# ── Ensemble ──────────────────────────────────
print("🔵 Creando Ensemble...")
ensemble = VotingClassifier(
    estimators=[('lgb', lgb_model), ('xgb', xgb_model), ('rf', rf_model)],
    voting='soft',
    weights=[2, 1.5, 1]
)
ensemble.fit(X_train_bal, y_train_bal)
ensemble_pred = ensemble.predict(X_test_scaled)
ensemble_acc  = accuracy_score(y_test, ensemble_pred)
print(f"✅ Ensemble Accuracy: {ensemble_acc:.4f}\n")

# ══════════════════════════════════════════════
# 8. REPORTES
# ══════════════════════════════════════════════
sep = "=" * 60
print(f"\n{sep}\n📊 ACCURACY POR MODELO\n")
print(f"  LightGBM:      {lgb_acc:.4f}")
print(f"  XGBoost:       {xgb_acc:.4f}")
print(f"  Random Forest: {rf_acc:.4f}")
print(f"  ENSEMBLE:      {ensemble_acc:.4f}")
print(sep)

print("\n📋 Classification Report (Ensemble):\n")
print(classification_report(
    y_test, ensemble_pred,
    target_names=['DOWN (0)', 'NEUTRAL (1)', 'UP (2)'],
    digits=4
))

print("\n📊 Confusion Matrix (Ensemble):\n")
cm = confusion_matrix(y_test, ensemble_pred)
print("           DOWN  NEUTRAL   UP")
for i, row in enumerate(cm):
    print(f"  {['DOWN   ','NEUTRAL','UP     '][i]}  {row[0]:5}   {row[1]:5}  {row[2]:4}")

# ── Feature importance (LightGBM) ────────────
print("\n📊 TOP 20 FEATURES (LightGBM):\n")
fi = pd.DataFrame({
    'feature':    FEATURE_NAMES,
    'importance': lgb_model.feature_importances_
}).sort_values('importance', ascending=False).head(20)

for _, row in fi.iterrows():
    print(f"  {row['feature']:35} {row['importance']:.0f}")

# ══════════════════════════════════════════════
# 9. GUARDAR MODELOS Y METADATA
# ══════════════════════════════════════════════
os.makedirs('models', exist_ok=True)

joblib.dump(ensemble,  'models/ensemble_model.pkl')
joblib.dump(lgb_model, 'models/lgb_model.pkl')
joblib.dump(xgb_model, 'models/xgb_model.pkl')
joblib.dump(rf_model,  'models/rf_model.pkl')
joblib.dump(scaler,    'models/scaler.pkl')

with open('models/feature_names.txt', 'w') as f:
    f.write('\n'.join(FEATURE_NAMES))

metadata = {
    "trained_at":        datetime.now().isoformat(),
    "train_period":      "2020-01-01 to 2023-12-31",
    "test_period":       "2024-01-01 to 2025-12-31",
    "split_type":        "temporal",
    "target_encoding":   {"0": "DOWN", "1": "NEUTRAL", "2": "UP"},
    "symbols":           symbols,
    "total_rows":        len(df),
    "train_rows":        int(len(X_train)),
    "train_rows_bal":    int(len(X_train_bal)),
    "test_rows":         int(len(X_test)),
    "features":          FEATURE_NAMES,
    "n_features":        len(FEATURE_NAMES),
    "ensemble_accuracy": float(ensemble_acc),
    "lgb_accuracy":      float(lgb_acc),
    "xgb_accuracy":      float(xgb_acc),
    "rf_accuracy":       float(rf_acc),
    "class_weights":     class_weight_dict,
}

with open('models/training_metadata.json', 'w') as f:
    json.dump(metadata, f, indent=2)

print(f"\n{sep}")
print("✅ Modelos guardados en models/")
print("✅ Metadata guardada en models/training_metadata.json")
print(f"{sep}")