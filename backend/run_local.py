"""Local CODN server: preserve the existing report flags and private storage."""

from app import app


if __name__ == '__main__':
    if not app.config.get('RETINOGRAPH_PRIVATE_DIR'):
        raise SystemExit('Configure RETINOGRAPH_PRIVATE_DIR antes de iniciar Flask local.')

    app.config.update(
        REPORTS_HISTORY_ENABLED=True,
        REPORTS_EDIT_ENABLED=False,
        REPORTS_ANNUL_ENABLED=False,
    )
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)
