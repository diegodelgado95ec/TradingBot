import sys
import json
import joblib
import numpy as np
import pandas as pd
from pathlib import Path

# Cargar modelos
MODEL_DIR = Path('./models')
ensemble_model = joblib.load(MODEL_DIR / 'ensemble_model.pkl')
scaler         = joblib.load(MODEL_DIR / 'scaler.pkl')

# Feature names exactos del scaler entrenado
FEATURE_NAMES = scaler.feature_names_in_.tolist()

def predict(features: dict) -> dict:
    """
    features debe contener OHLC + indicadores + historial de precios
    para calcular lag features y momentum
    """

    open_  = features.get('open',  0)
    high   = features.get('high',  0)
    low    = features.get('low',   0)
    close  = features.get('close', 0)

    # Indicadores base (camelCase - como está en el scaler)
    rsi           = features.get('rsi',           50)
    macd          = features.get('macd',           0)
    macdSignal    = features.get('macdSignal',     0)
    macdHistogram = features.get('macdHistogram',  0)
    bbUpper       = features.get('bbUpper',    close)
    bbMiddle      = features.get('bbMiddle',   close)
    bbLower       = features.get('bbLower',    close)
    ema9          = features.get('ema9',        close)
    ema21         = features.get('ema21',       close)
    ema50         = features.get('ema50',       close)
    stochK        = features.get('stochK',        50)
    stochD        = features.get('stochD',        50)
    atr           = features.get('atr',         0.001)

    # Lag features (historial de precios/RSI)
    close_lag1 = features.get('close_lag1', close)
    close_lag2 = features.get('close_lag2', close)
    close_lag3 = features.get('close_lag3', close)
    rsi_lag1   = features.get('rsi_lag1',   rsi)
    rsi_lag2   = features.get('rsi_lag2',   rsi)

    # Rolling stats
    close_sma_5  = features.get('close_sma_5',  close)
    close_sma_10 = features.get('close_sma_10', close)
    close_sma_20 = features.get('close_sma_20', close)
    close_std_5  = features.get('close_std_5',  0)
    close_std_10 = features.get('close_std_10', 0)

    # Features calculados
    volume_change    = features.get('volume_change', 0)
    price_change_1   = (close - close_lag1) / close_lag1 if close_lag1 != 0 else 0
    price_change_3   = (close - close_lag3) / close_lag3 if close_lag3 != 0 else 0
    close_lag5       = features.get('close_lag5', close)
    price_change_5   = (close - close_lag5) / close_lag5 if close_lag5 != 0 else 0

    # Ratios
    high_low_ratio       = (high - low) / low if low != 0 else 0
    close_to_ema9_ratio  = (close - ema9)  / ema9  if ema9  != 0 else 0
    close_to_ema21_ratio = (close - ema21) / ema21 if ema21 != 0 else 0

    # Momentum
    rsi_momentum   = rsi  - rsi_lag1
    macd_momentum  = features.get('macd_momentum', macd - macdSignal)
    stoch_momentum = stochK - stochD

    # BB position (0=lower band, 1=upper band)
    bb_range   = bbUpper - bbLower
    bb_position = (close - bbLower) / bb_range if bb_range != 0 else 0.5

    # Construir DataFrame con nombres exactos del scaler
    row = {
        'open':                open_,
        'high':                high,
        'low':                 low,
        'close':               close,
        'rsi':                 rsi,
        'macd':                macd,
        'macdSignal':          macdSignal,
        'macdHistogram':       macdHistogram,
        'bbUpper':             bbUpper,
        'bbMiddle':            bbMiddle,
        'bbLower':             bbLower,
        'ema9':                ema9,
        'ema21':               ema21,
        'ema50':               ema50,
        'stochK':              stochK,
        'stochD':              stochD,
        'atr':                 atr,
        'close_lag1':          close_lag1,
        'close_lag2':          close_lag2,
        'close_lag3':          close_lag3,
        'rsi_lag1':            rsi_lag1,
        'rsi_lag2':            rsi_lag2,
        'volume_change':       volume_change,
        'price_change_1':      price_change_1,
        'price_change_3':      price_change_3,
        'price_change_5':      price_change_5,
        'close_sma_5':         close_sma_5,
        'close_sma_10':        close_sma_10,
        'close_sma_20':        close_sma_20,
        'close_std_5':         close_std_5,
        'close_std_10':        close_std_10,
        'high_low_ratio':      high_low_ratio,
        'close_to_ema9_ratio': close_to_ema9_ratio,
        'close_to_ema21_ratio':close_to_ema21_ratio,
        'rsi_momentum':        rsi_momentum,
        'macd_momentum':       macd_momentum,
        'bb_position':         bb_position,
        'stoch_momentum':      stoch_momentum,
    }

    X = pd.DataFrame([row], columns=FEATURE_NAMES)

    # Escalar y predecir
    X_scaled      = scaler.transform(X)
    prediction    = ensemble_model.predict(X_scaled)[0]
    probabilities = ensemble_model.predict_proba(X_scaled)[0]
    confidence    = float(probabilities[prediction])

    return {
        "prediction":    int(prediction),
        "confidence":    confidence,
        "probabilities": [float(p) for p in probabilities]
    }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No features provided"}))
        sys.exit(1)

    try:
        features = json.loads(sys.argv[1])
        result   = predict(features)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
