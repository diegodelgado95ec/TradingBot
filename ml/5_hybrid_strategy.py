import pandas as pd
import numpy as np
import joblib
import lightgbm as lgb
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
import traceback

def load_models():
    """Cargar modelos entrenados"""
    try:
        print("📦 Cargando modelos...")
        lgb_model = lgb.Booster(model_file='models/lightgbm_model.txt')
        xgb_model = joblib.load('models/xgboost_model.pkl')
        rf_model = joblib.load('models/random_forest_model.pkl')
        scaler = joblib.load('models/scaler.pkl')
        feature_names = joblib.load('models/feature_names.pkl')
        print("✅ Modelos cargados correctamente")
        return lgb_model, xgb_model, rf_model, scaler, feature_names
    except Exception as e:
        print(f"❌ Error cargando modelos: {e}")
        traceback.print_exc()
        return None, None, None, None, None

def calculate_technical_signal(row):
    """
    Calcular señal basada en indicadores técnicos
    Retorna: señal (-1, 0, 1) y score
    """
    try:
        # RSI
        rsi = row.get('rsi', 50)
        rsi_bullish = 1 if rsi < 30 else (0.5 if rsi < 50 else 0)
        rsi_bearish = 1 if rsi > 70 else (0.5 if rsi > 50 else 0)
        
        # MACD
        macd = row.get('macd', 0)
        macd_signal = row.get('macdSignal', 0)
        macd_hist = row.get('macdHistogram', 0)
        macd_bullish = 1 if macd > macd_signal and macd_hist > 0 else 0
        macd_bearish = 1 if macd < macd_signal and macd_hist < 0 else 0
        
        # Bollinger Bands
        bb_percent = row.get('bbPercentB', 0.5)
        bb_bullish = 1 if bb_percent < 0.2 else 0
        bb_bearish = 1 if bb_percent > 0.8 else 0
        
        # EMA Trend
        ema9 = row.get('ema9', 0)
        ema21 = row.get('ema21', 0)
        ema_bullish = 1 if ema9 > ema21 else 0
        ema_bearish = 1 if ema9 < ema21 else 0
        
        # Stochastic
        stoch_k = row.get('stochK', 50)
        stoch_bullish = 1 if stoch_k < 20 else 0
        stoch_bearish = 1 if stoch_k > 80 else 0
        
        # Calcular scores
        bullish_score = rsi_bullish + macd_bullish + bb_bullish + ema_bullish + stoch_bullish
        bearish_score = rsi_bearish + macd_bearish + bb_bearish + ema_bearish + stoch_bearish
        
        # Decisión
        if bullish_score >= 3:
            return 1, bullish_score
        elif bearish_score >= 3:
            return -1, bearish_score
        else:
            return 0, max(bullish_score, bearish_score)
    
    except Exception as e:
        print(f"❌ Error en calculate_technical_signal: {e}")
        return 0, 0

def hybrid_prediction(ml_proba, technical_signal, technical_score):
    """Combinar ML con indicadores técnicos"""
    try:
        ml_pred = 1 if ml_proba > 0.5 else -1
        ml_confidence = abs(ml_proba - 0.5) * 200
        
        if ml_pred == 1 and technical_signal == 1:
            return 1, min(ml_confidence + technical_score * 10, 95), "ML+Tech UP"
        elif ml_pred == -1 and technical_signal == -1:
            return -1, min(ml_confidence + technical_score * 10, 95), "ML+Tech DOWN"
        elif ml_pred == 1 and technical_signal == 0 and ml_confidence > 55:
            return 1, ml_confidence * 0.7, "ML UP only"
        elif ml_pred == -1 and technical_signal == 0 and ml_confidence > 55:
            return -1, ml_confidence * 0.7, "ML DOWN only"
        else:
            return 0, 30, "No signal"
    except Exception as e:
        print(f"❌ Error en hybrid_prediction: {e}")
        return 0, 30, "Error"

def evaluate_hybrid_strategy():
    """Evaluar estrategia híbrida"""
    
    try:
        print("\n" + "="*70)
        print("🔀 EVALUACIÓN ESTRATEGIA HÍBRIDA (ML + INDICADORES)")
        print("="*70)
        
        # 1. Cargar datos
        print("\n📂 Cargando datos...")
        df = pd.read_csv('ml/features_processed.csv')
        print(f"✅ Datos cargados: {len(df):,} filas, {len(df.columns)} columnas")
        
        # 2. Split
        split_idx = int(len(df) * 0.8)
        df_val = df.iloc[split_idx:].copy()
        print(f"✅ Validación: {len(df_val):,} filas")
        
        # 3. Cargar modelos
        models = load_models()
        if models[0] is None:
            print("❌ No se pudieron cargar los modelos")
            return None, None
        
        lgb_model, xgb_model, rf_model, scaler, feature_names = models
        
        # 4. Preparar features
        print("\n🔧 Preparando features...")
        X_val = df_val[feature_names]
        y_val = df_val['target']
        y_val_bin = (y_val == 2).astype(int)
        
        # 5. Predicciones ML
        print("🤖 Generando predicciones ML...")
        lgb_proba = lgb_model.predict(X_val, num_iteration=lgb_model.best_iteration)
        xgb_proba = xgb_model.predict_proba(X_val)[:, 1]
        rf_proba = rf_model.predict_proba(X_val)[:, 1]
        
        ml_proba = lgb_proba * 0.4 + xgb_proba * 0.35 + rf_proba * 0.25
        
        print(f"✅ ML probabilidades generadas: {len(ml_proba)}")
        print(f"   Min: {ml_proba.min():.3f}, Max: {ml_proba.max():.3f}, Mean: {ml_proba.mean():.3f}")
        
        # 6. Señales híbridas
        print("\n🔄 Generando señales híbridas...")
        
        hybrid_signals = []
        hybrid_confidences = []
        hybrid_reasons = []
        
        for i, (idx, row) in enumerate(df_val.iterrows()):
            # Señal técnica
            tech_signal, tech_score = calculate_technical_signal(row)
            
            # ML proba
            ml_p = ml_proba[i]
            
            # Combinar
            signal, confidence, reason = hybrid_prediction(ml_p, tech_signal, tech_score)
            
            hybrid_signals.append(signal)
            hybrid_confidences.append(confidence)
            hybrid_reasons.append(reason)
        
        df_val['hybrid_signal'] = hybrid_signals
        df_val['hybrid_confidence'] = hybrid_confidences
        df_val['hybrid_reason'] = hybrid_reasons
        
        print(f"✅ Señales generadas: {len(hybrid_signals)}")
        
        # 7. Filtrar por confianza
        MIN_CONFIDENCE = 50
        df_tradeable = df_val[df_val['hybrid_confidence'] >= MIN_CONFIDENCE].copy()
        
        print(f"\n📊 RESULTADOS (confidence >= {MIN_CONFIDENCE}%):")
        print(f"   Total señales: {len(df_tradeable):,} ({len(df_tradeable)/len(df_val)*100:.1f}%)")
        print(f"   UP:   {sum(df_tradeable['hybrid_signal']==1):,}")
        print(f"   DOWN: {sum(df_tradeable['hybrid_signal']==-1):,}")
        print(f"   HOLD: {len(df_val) - len(df_tradeable):,}")
        
        # 8. Evaluar
        if len(df_tradeable) > 0:
            y_true = df_tradeable['target'].apply(lambda x: 1 if x == 2 else 0)
            y_pred = df_tradeable['hybrid_signal'].apply(lambda x: 1 if x == 1 else 0)
            
            print("\n📋 Classification Report:")
            print(classification_report(y_true, y_pred, target_names=['DOWN', 'UP'], zero_division=0))
            
            cm = confusion_matrix(y_true, y_pred)
            print("\n📊 Confusion Matrix:")
            print(cm)
            
            total_trades = len(df_tradeable)
            correct_trades = sum(y_true == y_pred)
            win_rate = correct_trades / total_trades * 100
            
            print(f"\n🎯 MÉTRICAS:")
            print(f"   Win Rate: {win_rate:.1f}%")
            print(f"   Total Trades: {total_trades}")
            print(f"   Wins: {correct_trades}")
            print(f"   Losses: {total_trades - correct_trades}")
            
            # Profit simulado
            wins = correct_trades
            losses = total_trades - correct_trades
            profit = (wins * 1.5) + (losses * -1.0)
            pf = (wins * 1.5) / abs(losses * 1.0) if losses > 0 else float('inf')
            
            print(f"\n💰 PROFIT SIMULADO (R:R 1:1.5):")
            print(f"   Total: {profit:.2f}%")
            print(f"   Profit Factor: {pf:.2f}")
        else:
            print("\n⚠️ No hay trades con confianza suficiente")
        
        # 9. Guardar config
        strategy_config = {
            'min_confidence': MIN_CONFIDENCE,
            'ml_weights': {'lgb': 0.4, 'xgb': 0.35, 'rf': 0.25}
        }
        joblib.dump(strategy_config, 'models/hybrid_strategy_config.pkl')
        print("\n💾 Config guardada: models/hybrid_strategy_config.pkl")
        
        print("\n" + "="*70)
        print("✅ EVALUACIÓN COMPLETADA")
        print("="*70)
        
        return df_val, df_tradeable
        
    except Exception as e:
        print(f"\n❌ ERROR GENERAL: {e}")
        traceback.print_exc()
        return None, None

if __name__ == "__main__":
    print("🚀 Iniciando evaluación híbrida...")
    result = evaluate_hybrid_strategy()
    if result[0] is not None:
        print("\n✅ Script completado exitosamente")
    else:
        print("\n❌ Script falló")
