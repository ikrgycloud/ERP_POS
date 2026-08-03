from shared_domain.documents import DocumentFamily
from shared_domain.settings import DEFAULT_INVOICE_TERMS, BusinessSettings, BusinessSettingsService
from shared_domain.sync import SyncDomain, SynchronizationService


def test_business_settings_defaults_and_prefix_overrides():
    service = BusinessSettingsService()
    settings = service.merge(
        BusinessSettings(),
        business_name="Pudami",
        invoice_prefix="BILL",
        return_prefix="RMA",
    )
    assert settings.business_name == "Pudami"
    assert settings.currency == "INR"
    assert service.document_prefix(settings, DocumentFamily.INVOICE) == "BILL"
    assert service.document_prefix(settings, DocumentFamily.RETURN) == "RMA"
    assert service.document_prefix(settings, DocumentFamily.ORDER) == "ORD"


def test_business_settings_can_be_derived_from_existing_profile_shape():
    service = BusinessSettingsService()
    settings = service.from_mapping(
        {
            "legal_name": "Pudami Retail Private Limited",
            "trade_name": "Pudami",
            "billing_address": "Main Road",
            "city": "Hyderabad",
            "state": "Telangana",
            "pincode": "500001",
            "gstin": "29ABCDE1234F1Z5",
            "pan": "ABCDE1234F",
            "mobile": "9876543210",
            "email": "billing@example.com",
        }
    )
    assert settings.company_name == "Pudami Retail Private Limited"
    assert settings.business_name == "Pudami"
    assert settings.address == "Main Road, Hyderabad, Telangana, 500001"
    assert settings.gst_number == "29ABCDE1234F1Z5"
    assert settings.phone == "9876543210"


def test_business_settings_invoice_terms_use_configured_or_default_policy():
    service = BusinessSettingsService()
    configured = BusinessSettings(terms_conditions="Line one\n\nLine two")
    assert service.invoice_terms(configured) == ("Line one", "Line two")

    with_refund_policy = BusinessSettings(refund_policy="Refunds require original invoice.")
    terms = service.invoice_terms(with_refund_policy)
    assert terms[0] == "Refunds require original invoice."
    assert terms[1:] == DEFAULT_INVOICE_TERMS[1:]


def test_synchronization_service_maps_mutations_to_domains():
    service = SynchronizationService()
    product_change = service.invalidation_for("/products/1", "PUT")
    assert SyncDomain.PRODUCTS in product_change.domains
    assert SyncDomain.INVENTORY in product_change.domains
    assert SyncDomain.DASHBOARD in product_change.domains
    assert product_change.method == "PUT"

    checkout = service.invalidation_for("/pos/cart/10/checkout", "POST")
    assert SyncDomain.INVOICES in checkout.domains
    assert SyncDomain.PAYMENTS in checkout.domains
    assert SyncDomain.REPORTS in checkout.domains
