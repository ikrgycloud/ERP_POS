# ERP + POS Shared Domain

Framework-independent business rules and data transfer objects used by both the
ERP and POS services. This package must not depend on FastAPI, SQLAlchemy, or
either application's database models.

## Install a released version

Use an immutable Git tag in each consuming repository:

```bash
pip install "erp-pos-shared-domain @ git+https://github.com/OWNER/erp-pos-shared-domain.git@v0.1.0"
```

Replace `OWNER` with the GitHub user or organisation that owns the repositories.
For production, pin a tag such as `v0.1.0`, never a branch such as `main`.

## Release process

1. Update `version` in `pyproject.toml`.
2. Run `python -m pytest -q`.
3. Commit, push, and create the matching Git tag, for example `v0.1.1`.
4. Update the pinned tag in the ERP and POS repositories and test each service.
