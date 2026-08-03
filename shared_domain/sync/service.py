"""Pure synchronization routing rules."""

from shared_domain.sync.dtos import CacheInvalidation, SyncDomain


class SynchronizationService:
    ROUTES: tuple[tuple[str, tuple[SyncDomain, ...]], ...] = (
        ("/products", (SyncDomain.PRODUCTS, SyncDomain.INVENTORY, SyncDomain.DASHBOARD, SyncDomain.REPORTS)),
        ("/inventory", (SyncDomain.INVENTORY, SyncDomain.PRODUCTS, SyncDomain.DASHBOARD, SyncDomain.REPORTS)),
        ("/pos/cart", (SyncDomain.INVENTORY, SyncDomain.INVOICES, SyncDomain.PAYMENTS, SyncDomain.CUSTOMERS, SyncDomain.DASHBOARD, SyncDomain.REPORTS)),
        ("/invoices", (SyncDomain.INVOICES, SyncDomain.PAYMENTS, SyncDomain.DASHBOARD, SyncDomain.REPORTS)),
        ("/returns", (SyncDomain.RETURNS, SyncDomain.INVOICES, SyncDomain.INVENTORY, SyncDomain.PAYMENTS, SyncDomain.CUSTOMERS, SyncDomain.DASHBOARD, SyncDomain.REPORTS)),
        ("/customers", (SyncDomain.CUSTOMERS, SyncDomain.DASHBOARD, SyncDomain.REPORTS)),
        ("/suppliers", (SyncDomain.SUPPLIERS, SyncDomain.PRODUCTS, SyncDomain.REPORTS)),
        ("/staff", (SyncDomain.STAFF, SyncDomain.DASHBOARD, SyncDomain.REPORTS)),
        ("/business-profile", (SyncDomain.SETTINGS, SyncDomain.DASHBOARD, SyncDomain.REPORTS)),
    )

    def invalidation_for(self, path: str, method: str) -> CacheInvalidation:
        normalized_path = path.split("?", 1)[0]
        domains: set[SyncDomain] = set()
        for prefix, affected in self.ROUTES:
            if normalized_path.startswith(prefix):
                domains.update(affected)
        if not domains:
            domains.update((SyncDomain.DASHBOARD, SyncDomain.REPORTS))
        return CacheInvalidation(
            domains=tuple(sorted(domains, key=lambda item: item.value)),
            source_path=path,
            method=method.upper(),
        )
