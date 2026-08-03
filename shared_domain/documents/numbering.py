"""Document numbering rules."""

from shared_domain.documents.constants import DEFAULT_PREFIXES, DocumentFamily


def document_prefix(
    family: DocumentFamily,
    overrides: dict[DocumentFamily | str, str] | None = None,
) -> str:
    """Resolve the document prefix from business settings or defaults."""

    if overrides:
        return (
            overrides.get(family)
            or overrides.get(family.value)
            or DEFAULT_PREFIXES[family]
        )
    return DEFAULT_PREFIXES[family]
