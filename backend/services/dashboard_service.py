from src.repositories.dashboard_repository import DashboardRepository
from utils.clinical_dates import unverified_clinical_fields
from utils.strict_authorization import evaluate_operation


def clinical_summary(user):
    return unverified_clinical_fields({
        'kpis': DashboardRepository.counts(),
        'severity': DashboardRepository.validated_eyes(),
        'recent_patients': DashboardRepository.recent_patients(),
        'actions': {
            'patients': evaluate_operation(user, 'patients.read'),
            'diagnosis': all(evaluate_operation(user, operation) for operation in
                             ('patients.read', 'diagnosis.read', 'diagnosis.create')),
            'reports': all(evaluate_operation(user, operation) for operation in
                           ('patients.read', 'reports.full_read', 'reports.create')),
        },
    })
