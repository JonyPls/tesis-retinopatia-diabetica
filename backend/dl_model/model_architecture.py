import torch
import torch.nn as nn
import torchvision.models as models
import pytorch_lightning as pl
from torchmetrics.classification import (
    Accuracy, 
    F1Score, 
    MulticlassCohenKappa, 
    AUROC, 
    Precision, 
    Recall
)

class RetinopatiaModel(pl.LightningModule):
    def __init__(self, nombre_arquitectura: str, num_classes: int = 5,
                 learning_rate: float = 1e-4, class_weights=None):
        super().__init__()
        # save_hyperparameters() es vital para que el .ckpt reconozca los argumentos
        self.save_hyperparameters()
        self.learning_rate = learning_rate

        if nombre_arquitectura == 'resnet50':
            backbone    = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V1)
            in_features = backbone.fc.in_features
            backbone.fc = nn.Linear(in_features, num_classes)
            self.model  = backbone

        elif nombre_arquitectura == 'efficientnet_b3':
            backbone = models.efficientnet_b3(weights=models.EfficientNet_B3_Weights.IMAGENET1K_V1)
            in_features = backbone.classifier[1].in_features
            backbone.classifier = nn.Sequential(
                nn.Dropout(p=0.3),
                nn.Linear(in_features, num_classes)
            )
            self.model = backbone

        elif nombre_arquitectura == 'mobilenet_v3':
            backbone = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.IMAGENET1K_V1)
            in_features = backbone.classifier[3].in_features
            backbone.classifier[3] = nn.Linear(in_features, num_classes)
            self.model = backbone

        else:
            raise ValueError(f"Arquitectura no reconocida: {nombre_arquitectura}")

        # Se mantienen la función de pérdida y métricas porque sus estados internos 
        # están guardados dentro del archivo .ckpt
        self.criterion = nn.CrossEntropyLoss(
            weight=class_weights,
            label_smoothing=0.1
        )

        args = dict(task='multiclass', num_classes=num_classes)
        self.train_acc   = Accuracy(**args)
        self.val_acc     = Accuracy(**args)
        self.val_f1      = F1Score(**args, average='macro')
        self.val_kappa   = MulticlassCohenKappa(num_classes=num_classes, weights='quadratic')
        self.test_acc    = Accuracy(**args)
        self.test_f1     = F1Score(**args, average='macro')
        self.test_kappa  = MulticlassCohenKappa(num_classes=num_classes, weights='quadratic')
        self.test_auroc  = AUROC(**args, average='macro')
        self.test_prec   = Precision(**args, average='macro')
        self.test_recall = Recall(**args, average='macro')

    def forward(self, x):
        """Método exclusivo para inferencia en producción"""
        return self.model(x)

    # Nota: Los métodos training_step, validation_step y configure_optimizers 
    # fueron omitidos intencionalmente ya que no son necesarios en el backend web.