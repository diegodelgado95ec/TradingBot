import pandas as pd
import numpy as np
import joblib
import lightgbm as lgb
import xgboost as xgb
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_recall_curve
import matplotlib.pyplot as plt

def load_data():
    """Cargar datos procesados"""
    df = pd.read_csv('ml/features_processed.csv')
    X = df.drop(['target', 'epoch'], axis=1)
    y = df['target']
    
    # Split temporal 80/20
    split_idx = int(len(X) * 0.8)
    X_train = X.iloc[:split_idx]
    y_train = y.iloc[:split_idx]
    X_val = X.iloc[split_idx:]
    y_val = y.iloc[split_idx:]
    
    return X_train, y_train, X_val, y_val

def train_optimized_models(X_train, y_train, X_val, y_val):
    """Entrenar modelos con class weights optimizados"""
    
    print("\n" + "="*70)
    print("🔧 ENTRENAMIENTO OPTIMIZADO CON CLASS WEIGHTS")
    print("="*70)
    
    y_train_bin = (y_train == 2).astype(int)
    y_val_bin = (y_val == 2).astype(int)
    
    # Calcular class weights (dar más importancia a la clase minoritaria)
    class_counts = np.bincount(y_train_bin)
    total_samples = len(y_train_bin)
    class_weight_0 = total_samples / (2 * class_counts[0])
    class_weight_1 = total_samples / (2 * class_counts[1])
    
    print(f"\n⚖️ Class Weights calculados:")
    print(f"   DOWN (0): {class_weight_0:.3f}")
    print(f"   UP (1):   {class_weight_1:.3f}")
    
    # 1. LightGBM con scale_pos_weight
    print("\n🌟 LightGBM Optimizado...")
    scale_pos_weight = class_counts[0] / class_counts[1]
    
    params_lgb = {
        'objective': 'binary',
        'metric': 'binary_logloss',
        'boosting_type': 'gbdt',
        'num_leaves': 50,
        'max_depth': 7,
        'learning_rate': 0.03,  # Más bajo para mejor generalización
        'feature_fraction': 0.8,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'min_data_in_leaf': 30,
        'scale_pos_weight': scale_pos_weight,  # ✅ Balance de clases
        'verbose': -1,
        'random_state': 42
    }
    
    train_data = lgb.Dataset(X_train, label=y_train_bin)
    val_data = lgb.Dataset(X_val, label=y_val_bin, reference=train_data)
    
    lgb_model = lgb.train(
        params_lgb,
        train_data,
        num_boost_round=300,
        valid_sets=[train_data, val_data],
        callbacks=[lgb.early_stopping(stopping_rounds=30), lgb.log_evaluation(period=50)]
    )
    
    # 2. XGBoost con scale_pos_weight
    print("\n🚀 XGBoost Optimizado...")
    xgb_model = xgb.XGBClassifier(
        objective='binary:logistic',
        n_estimators=300,
        max_depth=6,
        learning_rate=0.03,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=3,
        gamma=0.1,
        scale_pos_weight=scale_pos_weight,  # ✅ Balance de clases
        eval_metric='logloss',
        early_stopping_rounds=30,
        random_state=42,
        verbosity=0
    )
    
    xgb_model.fit(
        X_train, y_train_bin,
        eval_set=[(X_val, y_val_bin)],
        verbose=False
    )
    
    # 3. Random Forest con class_weight
    print("\n🌲 Random Forest Optimizado...")
    rf_model = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        min_samples_leaf=5,
        max_features='sqrt',
        class_weight='balanced',  # ✅ Balance automático
        random_state=42,
        n_jobs=-1,
        verbose=0
    )
    
    rf_model.fit(X_train, y_train_bin)
    
    return lgb_model, xgb_model, rf_model

def find_optimal_threshold(models, X_val, y_val):
    """Encontrar threshold óptimo para maximizar F1-score"""
    
    print("\n" + "="*70)
    print("🎯 OPTIMIZANDO THRESHOLD DE DECISIÓN")
    print("="*70)
    
    lgb_model, xgb_model, rf_model = models
    y_val_bin = (y_val == 2).astype(int)
    
    # Obtener probabilidades del ensemble
    lgb_proba = lgb_model.predict(X_val, num_iteration=lgb_model.best_iteration)
    xgb_proba = xgb_model.predict_proba(X_val)[:, 1]
    rf_proba = rf_model.predict_proba(X_val)[:, 1]
    
    # Ensemble ponderado
    ensemble_proba = (
        lgb_proba * 0.4 +
        xgb_proba * 0.35 +
        rf_proba * 0.25
    )
    
    # Probar diferentes thresholds
    thresholds = np.arange(0.3, 0.7, 0.02)
    best_threshold = 0.5
    best_f1 = 0
    results = []
    
    for threshold in thresholds:
        y_pred = (ensemble_proba >= threshold).astype(int)
        f1 = f1_score(y_val_bin, y_pred)
        acc = accuracy_score(y_val_bin, y_pred)
        
        results.append({
            'threshold': threshold,
            'f1_score': f1,
            'accuracy': acc
        })
        
        if f1 > best_f1:
            best_f1 = f1
            best_threshold = threshold
    
    print(f"\n✅ Threshold óptimo encontrado: {best_threshold:.3f}")
    print(f"   F1-Score: {best_f1:.4f}")
    
    # Evaluar con threshold óptimo
    y_pred_optimal = (ensemble_proba >= best_threshold).astype(int)
    acc_optimal = accuracy_score(y_val_bin, y_pred_optimal)
    
    print(f"   Accuracy: {acc_optimal:.4f}")
    
    # Distribución de predicciones
    pred_down = sum(y_pred_optimal == 0)
    pred_up = sum(y_pred_optimal == 1)
    print(f"\n📊 Distribución de predicciones:")
    print(f"   DOWN: {pred_down} ({pred_down/len(y_pred_optimal)*100:.1f}%)")
    print(f"   UP:   {pred_up} ({pred_up/len(y_pred_optimal)*100:.1f}%)")
    
    # Plot threshold vs metrics
    results_df = pd.DataFrame(results)
    
    plt.figure(figsize=(10, 6))
    plt.plot(results_df['threshold'], results_df['f1_score'], label='F1-Score', linewidth=2)
    plt.plot(results_df['threshold'], results_df['accuracy'], label='Accuracy', linewidth=2)
    plt.axvline(best_threshold, color='red', linestyle='--', label=f'Optimal: {best_threshold:.3f}')
    plt.xlabel('Threshold')
    plt.ylabel('Score')
    plt.title('Threshold Optimization')
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.savefig('models/threshold_optimization.png', dpi=300, bbox_inches='tight')
    print("\n💾 Gráfico guardado: models/threshold_optimization.png")
    
    return best_threshold, ensemble_proba

def evaluate_final_model(models, X_val, y_val, threshold):
    """Evaluación final con threshold optimizado"""
    
    print("\n" + "="*70)
    print("📊 EVALUACIÓN FINAL DEL MODELO OPTIMIZADO")
    print("="*70)
    
    lgb_model, xgb_model, rf_model = models
    y_val_bin = (y_val == 2).astype(int)
    
    # Predicciones ensemble
    lgb_proba = lgb_model.predict(X_val, num_iteration=lgb_model.best_iteration)
    xgb_proba = xgb_model.predict_proba(X_val)[:, 1]
    rf_proba = rf_model.predict_proba(X_val)[:, 1]
    
    ensemble_proba = (
        lgb_proba * 0.4 +
        xgb_proba * 0.35 +
        rf_proba * 0.25
    )
    
    y_pred = (ensemble_proba >= threshold).astype(int)
    
    # Métricas
    from sklearn.metrics import classification_report, confusion_matrix
    
    print("\n📋 Classification Report (Optimizado):")
    print(classification_report(y_val_bin, y_pred, target_names=['DOWN', 'UP']))
    
    cm = confusion_matrix(y_val_bin, y_pred)
    print("\n📊 Confusion Matrix:")
    print(cm)
    print(f"   True Negatives (DOWN correctos): {cm[0,0]}")
    print(f"   False Positives (DOWN → UP error): {cm[0,1]}")
    print(f"   False Negatives (UP → DOWN error): {cm[1,0]}")
    print(f"   True Positives (UP correctos): {cm[1,1]}")
    
    # Win Rate simulado
    total_up_signals = sum(y_pred == 1)
    correct_up_signals = cm[1,1]
    
    if total_up_signals > 0:
        win_rate = correct_up_signals / total_up_signals * 100
        print(f"\n🎯 WIN RATE ESTIMADO (señales UP): {win_rate:.1f}%")
    
    return y_pred, ensemble_proba

def main():
    print("\n" + "="*70)
    print("🚀 OPTIMIZACIÓN DE MODELOS ML")
    print("="*70)
    
    # 1. Cargar datos
    X_train, y_train, X_val, y_val = load_data()
    
    # 2. Entrenar modelos optimizados
    models = train_optimized_models(X_train, y_train, X_val, y_val)
    
    # 3. Encontrar threshold óptimo
    optimal_threshold, probabilities = find_optimal_threshold(models, X_val, y_val)
    
    # 4. Evaluación final
    y_pred, ensemble_proba = evaluate_final_model(models, X_val, y_val, optimal_threshold)
    
    # 5. Guardar modelos optimizados
    print("\n💾 Guardando modelos optimizados...")
    lgb_model, xgb_model, rf_model = models
    
    lgb_model.save_model('models/lightgbm_optimized.txt')
    joblib.dump(xgb_model, 'models/xgboost_optimized.pkl')
    joblib.dump(rf_model, 'models/random_forest_optimized.pkl')
    joblib.dump(optimal_threshold, 'models/optimal_threshold.pkl')
    
    print("✅ Modelos optimizados guardados")
    print(f"✅ Threshold óptimo: {optimal_threshold:.3f}")
    
    print("\n" + "="*70)
    print("✅ OPTIMIZACIÓN COMPLETADA")
    print("="*70)

if __name__ == "__main__":
    main()
