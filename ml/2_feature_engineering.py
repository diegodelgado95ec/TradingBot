import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
import joblib
import os

def calculate_missing_indicators(df):
    """Calcula indicadores técnicos faltantes desde price data"""
    
    print("🔧 Calculando indicadores técnicos faltantes...")
    
    # Reconstruir precio desde epoch (ya tienes closePrice)
    close = df['closePrice']
    
    # 1. RSI (Relative Strength Index) - 14 periodos
    delta = close.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / loss
    df['rsi'] = 100 - (100 / (1 + rs))
    
    # 2. EMAs (Exponential Moving Averages)
    df['ema9'] = close.ewm(span=9, adjust=False).mean()
    df['ema21'] = close.ewm(span=21, adjust=False).mean()
    df['ema50'] = close.ewm(span=50, adjust=False).mean()
    
    # 3. MACD (Moving Average Convergence Divergence)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df['macd'] = ema12 - ema26
    df['macdSignal'] = df['macd'].ewm(span=9, adjust=False).mean()
    df['macdHistogram'] = df['macd'] - df['macdSignal']
    
    # 4. Bollinger Bands (20 periodos, 2 std)
    sma20 = close.rolling(window=20).mean()
    std20 = close.rolling(window=20).std()
    df['bbUpper'] = sma20 + (std20 * 2)
    df['bbMiddle'] = sma20
    df['bbLower'] = sma20 - (std20 * 2)
    df['bbWidth'] = (df['bbUpper'] - df['bbLower']) / df['bbMiddle']
    df['bbPercentB'] = (close - df['bbLower']) / (df['bbUpper'] - df['bbLower'])
    
    # 5. Stochastic Oscillator (14 periodos)
    low14 = close.rolling(window=14).min()
    high14 = close.rolling(window=14).max()
    df['stochK'] = 100 * (close - low14) / (high14 - low14)
    df['stochD'] = df['stochK'].rolling(window=3).mean()
    
    # 6. ATR (Average True Range) - 14 periodos
    # Aproximamos usando highLowRange que ya tienes
    df['atr'] = df['highLowRange'].rolling(window=14).mean()
    
    print("✅ Indicadores calculados")
    return df

def create_advanced_features(df):
    """Crea features avanzados para ML"""
    
    print("\n🔧 Creando features avanzados...")
    
    close = df['closePrice']
    
    # 1. LAG FEATURES (valores pasados)
    for lag in [1, 2, 3, 5, 10]:
        df[f'close_lag_{lag}'] = close.shift(lag)
        df[f'rsi_lag_{lag}'] = df['rsi'].shift(lag)
        df[f'macd_lag_{lag}'] = df['macd'].shift(lag)
    
    # 2. ROLLING STATISTICS (ventanas móviles)
    for window in [5, 10, 20, 50]:
        df[f'close_roll_mean_{window}'] = close.rolling(window).mean()
        df[f'close_roll_std_{window}'] = close.rolling(window).std()
        df[f'close_roll_max_{window}'] = close.rolling(window).max()
        df[f'close_roll_min_{window}'] = close.rolling(window).min()
    
    # 3. MOMENTUM INDICATORS [web:11]
    df['momentum_5'] = close - close.shift(5)
    df['momentum_10'] = close - close.shift(10)
    df['momentum_20'] = close - close.shift(20)
    df['rate_of_change_5'] = (close - close.shift(5)) / close.shift(5) * 100
    df['rate_of_change_10'] = (close - close.shift(10)) / close.shift(10) * 100
    
    # 4. VOLATILITY FEATURES
    df['volatility_5'] = close.rolling(5).std()
    df['volatility_10'] = close.rolling(10).std()
    df['volatility_20'] = close.rolling(20).std()
    df['volatility_ratio'] = df['volatility_5'] / df['volatility_20']
    
    # 5. PRICE POSITION INDICATORS
    df['distance_from_ema9'] = (close - df['ema9']) / df['ema9'] * 100
    df['distance_from_ema21'] = (close - df['ema21']) / df['ema21'] * 100
    df['distance_from_ema50'] = (close - df['ema50']) / df['ema50'] * 100
    df['distance_from_bb_upper'] = (df['bbUpper'] - close) / close * 100
    df['distance_from_bb_lower'] = (close - df['bbLower']) / close * 100
    
    # 6. TREND INDICATORS
    df['ema_trend_short'] = np.where(df['ema9'] > df['ema21'], 1, -1)
    df['ema_trend_long'] = np.where(df['ema21'] > df['ema50'], 1, -1)
    df['macd_trend'] = np.where(df['macd'] > df['macdSignal'], 1, -1)
    df['price_above_ema9'] = np.where(close > df['ema9'], 1, 0)
    df['price_above_ema50'] = np.where(close > df['ema50'], 1, 0)
    
    # 7. RANGE & SPREAD FEATURES
    df['high_low_range_pct'] = df['highLowRange'] / close * 100
    df['body_to_range_ratio'] = df['candleBodySize'] / 100  # Ya está normalizado
    
    # 8. RSI FEATURES
    df['rsi_overbought'] = np.where(df['rsi'] > 70, 1, 0)
    df['rsi_oversold'] = np.where(df['rsi'] < 30, 1, 0)
    df['rsi_momentum'] = df['rsi'] - df['rsi'].shift(5)
    
    # 9. BOLLINGER FEATURES
    df['bb_squeeze'] = np.where(df['bbWidth'] < df['bbWidth'].rolling(20).mean() * 0.7, 1, 0)
    df['bb_breakout_up'] = np.where(close > df['bbUpper'], 1, 0)
    df['bb_breakout_down'] = np.where(close < df['bbLower'], 1, 0)
    
    # 10. STOCHASTIC FEATURES
    df['stoch_overbought'] = np.where(df['stochK'] > 80, 1, 0)
    df['stoch_oversold'] = np.where(df['stochK'] < 20, 1, 0)
    df['stoch_cross'] = np.where(df['stochK'] > df['stochD'], 1, -1)
    
    # 11. VOLUME/VOLATILITY REGIME (ya tienes)
    df['is_high_volatility'] = np.where(df['volatilityRegime'] == 'high', 1, 0)
    df['is_medium_volatility'] = np.where(df['volatilityRegime'] == 'medium', 1, 0)
    df['is_low_volatility'] = np.where(df['volatilityRegime'] == 'low', 1, 0)
    
    # 12. INTERACTION FEATURES [web:16]
    df['rsi_macd_interaction'] = df['rsi'] * df['macd']
    df['rsi_bb_interaction'] = df['rsi'] * df['bbPercentB']
    df['macd_volatility'] = df['macd'] * df['volatility_10']
    
    # 13. PATTERN FEATURES (candlestick patterns ya tienes)
    df['bullish_pattern_strength'] = (
        df['isBullishEngulfing'].astype(int) * 2 +
        np.where(df['ema_trend_short'] == 1, 1, 0) +
        np.where(df['rsi'] < 50, 1, 0)
    )
    df['bearish_pattern_strength'] = (
        df['isBearishEngulfing'].astype(int) * 2 +
        np.where(df['ema_trend_short'] == -1, 1, 0) +
        np.where(df['rsi'] > 50, 1, 0)
    )
    
    print(f"✅ Features avanzados creados: {len(df.columns)} columnas totales")
    return df

def prepare_data(csv_path='training_data_30days.csv'):
    """Prepara datos para entrenamiento de ML"""
    
    print("\n" + "="*70)
    print("📊 PREPARANDO DATOS PARA MACHINE LEARNING")
    print("="*70)
    
    df = pd.read_csv(csv_path)
    print(f"\n📁 Datos originales: {len(df):,} filas, {len(df.columns)} columnas")
    print(f"📋 Columnas originales: {list(df.columns)[:8]}...")
    
    # Calcular indicadores faltantes
    df = calculate_missing_indicators(df)
    
    # Crear features avanzados
    df = create_advanced_features(df)
    
    # ✅ NUEVO: Eliminar solo las columnas con TODOS los valores NaN
    df = df.dropna(axis=1, how='all')
    
    print(f"\n🧹 NaN por columna (primeras 10):")
    nan_counts = df.isnull().sum()
    for col in nan_counts.head(10).items():
        print(f"   {col[0]}: {col[1]} NaN")
    
    # ✅ NUEVO: Eliminar filas solo desde donde los indicadores están completos
    # Los indicadores necesitan ~50 períodos de warmup
    WARMUP_PERIODS = 60  # Mayor lag usado + margen de seguridad
    df_clean = df.iloc[WARMUP_PERIODS:].copy()
    
    # Ahora eliminar filas con NaN restantes
    initial_rows = len(df_clean)
    df_clean = df_clean.dropna()
    removed_rows = initial_rows - len(df_clean)
    
    print(f"\n🧹 Limpieza de datos:")
    print(f"   - Warmup eliminado: {WARMUP_PERIODS} filas")
    print(f"   - NaN adicionales: {removed_rows} filas")
    print(f"   - ✅ Filas finales: {len(df_clean):,} filas")
    
    if len(df_clean) == 0:
        print("\n❌ ERROR: No quedan datos después de limpiar NaN")
        print("\n🔍 Debugging - Columnas con más NaN:")
        print(df.isnull().sum().sort_values(ascending=False).head(20))
        return None, None, None
    
    # Crear variable target
    print("\n🎯 Creando variable target...")
    
    # Verificar que existe priceDirectionNext5m
    if 'priceDirectionNext5m' not in df_clean.columns:
        print("❌ ERROR: columna 'priceDirectionNext5m' no existe")
        print(f"📋 Columnas disponibles: {list(df_clean.columns)}")
        return None, None, None
    
    df_clean = df_clean.copy()  # Evitar SettingWithCopyWarning
    df_clean['target'] = df_clean['priceDirectionNext5m'].fillna(0)
    df_clean['target'] = df_clean['target'].map({-1: 0, 0: 1, 1: 2})
    
    # Verificar distribución
    target_counts = df_clean['target'].value_counts().sort_index()
    print(f"\n📊 Distribución de clases (5min forward):")
    
    if len(target_counts) == 0:
        print("❌ ERROR: No hay targets válidos")
        return None, None, None
    
    for label, count in target_counts.items():
        if pd.notna(label):
            label_name = ['DOWN', 'NEUTRAL', 'UP'][int(label)]
            pct = count / len(df_clean) * 100
            print(f"   {label_name} ({int(label)}): {count:,} ({pct:.1f}%)")
    
    # Separar features y target
    exclude_cols = [
        'epoch', 'target', 'priceDirectionNext1m', 'priceDirectionNext5m', 
        'profitPotential', 'closePrice', 'volatilityRegime'
    ]
    
    feature_cols = [col for col in df_clean.columns if col not in exclude_cols]
    
    X = df_clean[feature_cols]
    y = df_clean['target']
    
    # Eliminar cualquier NaN en target
    valid_mask = y.notna()
    X = X[valid_mask]
    y = y[valid_mask]
    
    print(f"\n📈 Features finales para ML: {len(feature_cols)}")
    print(f"📊 Muestras finales: {len(X):,}")
    print(f"📊 Ejemplos de features: {feature_cols[:10]}")
    
    if len(X) == 0:
        print("\n❌ ERROR: No quedan muestras después de filtrar")
        return None, None, None
    
    # Normalizar features
    print("\n⚙️ Normalizando features con StandardScaler...")
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    X_scaled = pd.DataFrame(X_scaled, columns=feature_cols, index=X.index)
    
    # Crear carpeta models si no existe
    os.makedirs('models', exist_ok=True)
    
    # Guardar artifacts
    joblib.dump(scaler, 'models/scaler.pkl')
    joblib.dump(feature_cols, 'models/feature_names.pkl')
    print("\n💾 Scaler guardado: models/scaler.pkl")
    print("💾 Feature names guardado: models/feature_names.pkl")
    
    # Guardar datos procesados
    X_scaled['target'] = y.values
    X_scaled['epoch'] = df_clean.loc[X.index, 'epoch'].values
    X_scaled.to_csv('ml/features_processed.csv', index=False)
    print("💾 Datos procesados: ml/features_processed.csv")
    
    print("\n" + "="*70)
    print("✅ PREPARACIÓN DE DATOS COMPLETADA")
    print("="*70)
    print(f"\n📊 RESUMEN FINAL:")
    print(f"   - Total features: {len(feature_cols)}")
    print(f"   - Total muestras: {len(X):,}")
    print(f"   - Distribución: DOWN={sum(y==0)}, NEUTRAL={sum(y==1)}, UP={sum(y==2)}")
    
    return X_scaled, y, feature_cols

if __name__ == "__main__":
    result = prepare_data()
    if result[0] is not None:
        X, y, feature_names = result
        print("\n🎯 SIGUIENTE PASO:")
        print("   python ml/3_train_ensemble.py")
    else:
        print("\n❌ Fallo en la preparación de datos. Revisa los errores arriba.")
