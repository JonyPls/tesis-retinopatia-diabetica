# CB-03 — Matriz previa de escenarios

Ningún escenario de integración se ejecutó. Estados PENDIENTE; caso global BLOQUEADO por entorno/autorización.

| Código | Condición / entrada | Aserción esperada | Método | Obtenido |
|---|---|---|---|---|
| S01 | V1 válida | Lista exacta R2/R1, orden Alfa/Beta, IDs de visita correctos. | `test_01_valid_visit_exact_active_reports_and_order` | PENDIENTE — no ejecutado |
| S02 | V2 y VB como controles | Intersección vacía con V1; conjuntos propios exactos. | `test_02_other_visits_and_patient_are_excluded` | PENDIENTE — no ejecutado |
| S03 | ACTIVO/INACTIVO/ANULADO | Incluir R1; excluir R3/R4; solo ACTIVO serializado. | `test_03_report_states_active_inactive_annulled` | PENDIENTE — no ejecutado |
| S04 | V0 sin informes | [], total=0, tiene_informes=0, diagnostico_ia=None. | `test_04_visit_without_reports_returns_empty_collection` | PENDIENTE — no ejecutado |
| S05 | validar_visita(VB,A) | NotFound real; control V1/A válido. | `test_05_foreign_visit_rejected_with_real_notfound` | PENDIENTE — no ejecutado |
| S06 | VA anulada y R7 activo | Listado incluye R7; detalle None; historial excluye VA; validar_visita lanza NotFound. Diferencia documentada. | `test_06_annulled_visit_characterizes_distinct_predicates` | PENDIENTE — no ejecutado |
| S07 | Dos ojos y versiones R1 | Conteo activo=2, ojos=2, versiones_R1=2; diagnóstico real distinto del ID visita. | `test_07_counts_do_not_multiply_by_eyes_or_versions` | PENDIENTE — no ejecutado |
| S08 | A con V1/V2/V0 y B/VB | Agrupación exacta por visita; ninguna contaminación; fallback de conclusión JSON. | `test_08_patient_reports_are_grouped_under_exact_visit` | PENDIENTE — no ejecutado |
| S09 | Detalle R1/R3/R4/R7/R8 | Vigencia de informe/visita/paciente; metadatos de paciente y visita; contraste de VI en listado. | `test_09_individual_report_filters_report_visit_and_patient` | PENDIENTE — no ejecutado |
| S10 | E sin visitas y recursos inexistentes | Retorno temprano con una consulta real (spy wraps); lista vacía/None/NotFound; fase DML cerrada. | `test_10_real_early_return_missing_resources_and_read_only_queries` | PENDIENTE — no ejecutado |

## Fixtures sintéticas (sin IDs asignados)

| Informe | Paciente | Visita | Tipo | Estado | Versiones |
|---|---|---|---|---|---:|
| R1 | A | V1 | T2/Beta | ACTIVO | 2 |
| R2 | A | V1 | T1/Alfa | ACTIVO | 1 |
| R3 | A | V1 | T3/Gamma | INACTIVO | 1 |
| R4 | A | V1 | T4/Omega | ANULADO | 1 |
| R5 | A | V2 | T1/Alfa | ACTIVO | 1 |
| R6 | B | VB | T1/Alfa | ACTIVO | 1 |
| R7 | A | VA | T1/Alfa | ACTIVO | 1 |
| R8 | I | VI | T1/Alfa | ACTIVO | 1 |

V0 no tiene informes. E no tiene visitas. VI pertenece al paciente inactivo I.
Se usarán 1 tipo documental, 1 cargo, 1 usuario sin login, 4 pacientes, 6 visitas,
4 tipos de informe, 8 informes, 9 versiones, 2 grados sintéticos, 2 diagnósticos y 2 detalles.
Total previsto: 40 filas, todas nuevas y sintéticas, en 11 tablas InnoDB. Ningún archivo fotográfico.
IDs obtenidos con flush/autoincrement; si V1 y su diagnóstico coinciden, abortar/revertir y revisar la fixture, nunca asumir alias universal.
