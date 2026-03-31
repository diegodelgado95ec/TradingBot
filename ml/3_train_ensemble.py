import pandas as pd
import numpy as np
import joblib
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, f1_score
import lightgbm as lgb
import xgboost as xgb
import matplotlib.pyplot as plt
import seaborn as sns
import warnings
warnings.filterwarnings('ignore')

def load_data():
    """Cargar datos procesados"""
    print("\n" + "="*70)
    print("📊 CARGANDO DATOS PROCESADOS")
    print("="*70)
    
    df = pd.read_csv('ml/features_processed.csv')
    
    # Separar features, target y epoch
    X = df.drop(['target', 'epoch'], axis=1)
    y = df['target']
    epochs = df['epoch']
    
    print(f"\n✅ Datos cargados:")
    print(f"   - Features: {X.shape[1]}")
    print(f"   - Muestras: {len(X):,}")
    print(f"   - Clases: {y.unique()}")
    print(f"   - Distribución: DOWN={sum(y==0)} ({sum(y==0)/len(y)*100:.1f}%), UP={sum(y==2)} ({sum(y==2)/len(y)*100:.1f}%)")
    
    return X, y, epochs

def train_lightgbm(X_train, y_train, X_val, y_val):
    """Entrenar LightGBM"""
    print("\n🌟 Entrenando LightGBM...")
    
    params = {
        'objective': 'binary',
        'metric': 'binary_logloss',
        'boosting_type': 'gbdt',
        'num_leaves': 50,
        'max_depth': 7,
        'learning_rate': 0.05,
        'feature_fraction': 0.8,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'min_data_in_leaf': 50,
        'verbose': -1,
        'random_state': 42
    }
    
    # Convertir target a binario (0=DOWN, 1=UP)
    y_train_bin = (y_train == 2).astype(int)
    y_val_bin = (y_val == 2).astype(int)
    
    train_data = lgb.Dataset(X_train, label=y_train_bin)
    val_data = lgb.Dataset(X_val, label=y_val_bin, reference=train_data)
    
    model = lgb.train(
        params,
        train_data,
        num_boost_round=200,
        valid_sets=[train_data, val_data],
        callbacks=[lgb.early_stopping(stopping_rounds=20), lgb.log_evaluation(period=50)]
    )
    
    # Evaluar
    y_pred_proba = model.predict(X_val, num_iteration=model.best_iteration)
    y_pred = (y_pred_proba > 0.5).astype(int)
    accuracy = accuracy_score(y_val_bin, y_pred)
    
    print(f"✅ LightGBM - Accuracy: {accuracy:.4f}")
    
    return model

def train_xgboost(X_train, y_train, X_val, y_val):
    """Entrenar XGBoost"""
    print("\n🚀 Entrenando XGBoost...")
    
    # Convertir target a binario
    y_train_bin = (y_train == 2).astype(int)
    y_val_bin = (y_val == 2).astype(int)
    
    model = xgb.XGBClassifier(
        objective='binary:logistic',
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=3,
        gamma=0.1,
        eval_metric='logloss',
        early_stopping_rounds=20,
        random_state=42,
        verbosity=1
    )
    
    model.fit(
        X_train, y_train_bin,
        eval_set=[(X_val, y_val_bin)],
        verbose=50
    )
    
    # Evaluar
    y_pred = model.predict(X_val)
    accuracy = accuracy_score(y_val_bin, y_pred)
    
    print(f"✅ XGBoost - Accuracy: {accuracy:.4f}")
    
    return model

def train_random_forest(X_train, y_train, X_val, y_val):
    """Entrenar Random Forest"""
    print("\n🌲 Entrenando Random Forest...")
    
    # Convertir target a binario
    y_train_bin = (y_train == 2).astype(int)
    y_val_bin = (y_val == 2).astype(int)
    
    model = RandomForestClassifier(
        n_estimators=150,
        max_depth=10,
        min_samples_split=10,
        min_samples_leaf=5,
        max_features='sqrt',
        random_state=42,
        n_jobs=-1,
        verbose=1
    )
    
    model.fit(X_train, y_train_bin)
    
    # Evaluar
    y_pred = model.predict(X_val)
    accuracy = accuracy_score(y_val_bin, y_pred)
    
    print(f"✅ Random Forest - Accuracy: {accuracy:.4f}")
    
    return model

def create_ensemble_predictions(lgb_model, xgb_model, rf_model, X):
    """Crear predicciones ensemble con voting"""
    
    # LightGBM predicciones
    lgb_pred_proba = lgb_model.predict(X, num_iteration=lgb_model.best_iteration)
    
    # XGBoost predicciones
    xgb_pred_proba = xgb_model.predict_proba(X)[:, 1]
    
    # Random Forest predicciones
    rf_pred_proba = rf_model.predict_proba(X)[:, 1]
    
    # Ensemble: Promedio ponderado (LightGBM tiene más peso)
    ensemble_proba = (
        lgb_pred_proba * 0.4 +
        xgb_pred_proba * 0.35 +
        rf_pred_proba * 0.25
    )
    
    # Convertir a clase
    ensemble_pred = (ensemble_proba > 0.5).astype(int)
    
    return ensemble_pred, ensemble_proba

def evaluate_ensemble(lgb_model, xgb_model, rf_model, X_val, y_val):
    """Evaluar ensemble"""
    
    print("\n" + "="*70)
    print("📊 EVALUANDO ENSEMBLE")
    print("="*70)
    
    y_val_bin = (y_val == 2).astype(int)
    
    # Predicciones individuales
    print("\n📈 Modelos Individuales:")
    
    lgb_pred = (lgb_model.predict(X_val, num_iteration=lgb_model.best_iteration) > 0.5).astype(int)
    print(f"   LightGBM - Accuracy: {accuracy_score(y_val_bin, lgb_pred):.4f}")
    
    xgb_pred = xgb_model.predict(X_val)
    print(f"   XGBoost  - Accuracy: {accuracy_score(y_val_bin, xgb_pred):.4f}")
    
    rf_pred = rf_model.predict(X_val)
    print(f"   Random Forest - Accuracy: {accuracy_score(y_val_bin, rf_pred):.4f}")
    
    # Ensemble
    ensemble_pred, ensemble_proba = create_ensemble_predictions(lgb_model, xgb_model, rf_model, X_val)
    
    print(f"\n🏆 ENSEMBLE - Accuracy: {accuracy_score(y_val_bin, ensemble_pred):.4f}")
    print(f"🏆 ENSEMBLE - F1-Score: {f1_score(y_val_bin, ensemble_pred):.4f}")
    
    # Reporte detallado
    print("\n📋 Classification Report:")
    print(classification_report(y_val_bin, ensemble_pred, target_names=['DOWN', 'UP']))
    
    # Matriz de confusión
    cm = confusion_matrix(y_val_bin, ensemble_pred)
    print("\n📊 Confusion Matrix:")
    print(cm)
    print(f"   True Negatives (DOWN correctos): {cm[0,0]}")
    print(f"   False Positives (DOWN predicho UP): {cm[0,1]}")
    print(f"   False Negatives (UP predicho DOWN): {cm[1,0]}")
    print(f"   True Positives (UP correctos): {cm[1,1]}")
    
    return ensemble_pred, ensemble_proba

def plot_feature_importance(lgb_model, xgb_model, rf_model, feature_names):
    """Graficar importancia de features"""
    
    print("\n📊 Generando gráficos de importancia...")
    
    # LightGBM importance
    lgb_importance = pd.DataFrame({
        'feature': feature_names,
        'importance': lgb_model.feature_importance(importance_type='gain')
    }).sort_values('importance', ascending=False).head(20)
    
    # XGBoost importance
    xgb_importance = pd.DataFrame({
        'feature': feature_names,
        'importance': xgb_model.feature_importances_
    }).sort_values('importance', ascending=False).head(20)
    
    # Plot
    fig, axes = plt.subplots(1, 2, figsize=(16, 6))
    
    sns.barplot(data=lgb_importance, x='importance', y='feature', ax=axes[0])
    axes[0].set_title('LightGBM - Top 20 Features')
    
    sns.barplot(data=xgb_importance, x='importance', y='feature', ax=axes[1])
    axes[1].set_title('XGBoost - Top 20 Features')
    
    plt.tight_layout()
    plt.savefig('models/feature_importance.png', dpi=300, bbox_inches='tight')
    print("💾 Gráfico guardado: models/feature_importance.png")
    
    return lgb_importance, xgb_importance

def main():
    """Pipeline principal de entrenamiento"""
    
    print("\n" + "="*70)
    print("🤖 ENTRENAMIENTO DE ENSEMBLE ML - TRADING BOT")
    print("="*70)
    
    # 1. Cargar datos
    X, y, epochs = load_data()
    
    # 2. Split temporal (80% train, 20% validation)
    split_idx = int(len(X) * 0.8)
    
    X_train = X.iloc[:split_idx]
    y_train = y.iloc[:split_idx]
    X_val = X.iloc[split_idx:]
    y_val = y.iloc[split_idx:]
    
    print(f"\n📊 Split de datos:")
    print(f"   Train: {len(X_train):,} muestras ({len(X_train)/len(X)*100:.1f}%)")
    print(f"   Val:   {len(X_val):,} muestras ({len(X_val)/len(X)*100:.1f}%)")
    
    # 3. Entrenar modelos
    lgb_model = train_lightgbm(X_train, y_train, X_val, y_val)
    xgb_model = train_xgboost(X_train, y_train, X_val, y_val)
    rf_model = train_random_forest(X_train, y_train, X_val, y_val)
    
    # 4. Evaluar ensemble
    ensemble_pred, ensemble_proba = evaluate_ensemble(lgb_model, xgb_model, rf_model, X_val, y_val)
    
    # 5. Feature importance
    feature_names = joblib.load('models/feature_names.pkl')
    lgb_imp, xgb_imp = plot_feature_importance(lgb_model, xgb_model, rf_model, feature_names)
    
    # 6. Guardar modelos
    print("\n💾 Guardando modelos...")
    lgb_model.save_model('models/lightgbm_model.txt')
    joblib.dump(xgb_model, 'models/xgboost_model.pkl')
    joblib.dump(rf_model, 'models/random_forest_model.pkl')
    
    print("✅ Modelos guardados:")
    print("   - models/lightgbm_model.txt")
    print("   - models/xgboost_model.pkl")
    print("   - models/random_forest_model.pkl")
    
    # 7. Guardar top features
    top_features = {
        'lightgbm_top20': lgb_imp.to_dict('records'),
        'xgboost_top20': xgb_imp.to_dict('records')
    }
    joblib.dump(top_features, 'models/top_features.pkl')
    
    print("\n" + "="*70)
    print("✅ ENTRENAMIENTO COMPLETADO")
    print("="*70)
    print("\n🎯 SIGUIENTE PASO:")
    print("   Integrar modelos en tu bot de trading (Node.js)")

if __name__ == "__main__":
    main()
