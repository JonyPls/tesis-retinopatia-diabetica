"""Entrada segura. Sin --execute solo hace inspección local; nunca importa app.py."""
import argparse
import json
from pathlib import Path

from discard_mysql77.safety import SafetyError, load_plan, preflight


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path)
    parser.add_argument('--execute', action='store_true', help='Solo con autorización posterior 78')
    parser.add_argument('--authorize-run', help='Confirmación independiente del UUID autorizado')
    args = parser.parse_args(argv)
    source = Path(__file__).resolve().parent
    try:
        plan = load_plan(args.config) if args.config else None
        if args.execute:
            from discard_mysql77.runtime import execute
            return execute(source, plan, args.authorize_run)
        if args.authorize_run:
            raise SafetyError('CONFIRMACION_SIN_FASE_B')
        print(json.dumps(preflight(source, plan), indent=2))
        return 0
    except SafetyError as error:
        print(json.dumps({'status': 'BLOCKED', 'code': str(error)}))
        return 2
    except Exception:
        # No volcar errores externos que pudieran contener DSN/secretos.
        print(json.dumps({'status': 'BLOCKED', 'code': 'FALLO_LOCAL_REQUIERE_REVISION'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
