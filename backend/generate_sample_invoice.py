import os
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from app.invoice_pdf import build_invoice_pdf
from app.models import BusinessProfile, Customer

class FakeDb:
    def __init__(self, seller=None, buyer=None):
        self.seller = seller
        self.buyer = buyer

    def get(self, model, _identity):
        if model is BusinessProfile:
            return self.seller
        if model is Customer:
            return self.buyer
        return None

seller = SimpleNamespace(
    logo_text='ERP', trade_name='Acme ERP', legal_name='Acme ERP Pvt Ltd',
    billing_address='1 Business Park', city='Bengaluru', state='Karnataka',
    pincode='560001', mobile='9999999999', email='billing@example.com',
    gstin='29ABCDE1234F1Z5', pan='ABCDE1234F', currency='INR', bank_name='HDFC Bank',
    account_number='1234567890', ifsc='HDFC0001234', upi_id='acme@upi',
    terms_conditions='Configured return policy.\nConfigured jurisdiction term.',
    authorized_person='Jane Doe', designation='Accounts Manager', company_name='Acme ERP Pvt Ltd',
)
buyer = SimpleNamespace(name='John Smith', address='456 MG Road', city='Bengaluru', state='Karnataka', pincode='560001', phone='9876543210', email=None)
order = SimpleNamespace(order_number='SO-2026-001', date=date(2026,7,20), items=[SimpleNamespace(quantity=Decimal('1'), rate=Decimal('1000'), gst_rate=Decimal('18'), unit_label='Nos', unit_type='pieces', product=SimpleNamespace(name='Premium enterprise product', sku='SKU-001'), product_id=1)], supplier_id=None)
invoice = SimpleNamespace(
    business_profile_id=1, outlet_id=None, customer_id=1, invoice_direction='outlet_to_customer',
    party_name='John Smith', party_type='B2C', invoice_number='INV-2026-001', id=1, date=date(2026,7,20),
    due_date=date(2026,8,4), invoice_type='Sale', status='Partially Paid', is_reverse=False,
    order=order, order_id=1, taxable_value=Decimal('1000'), cgst=Decimal('90'), sgst=Decimal('90'),
    igst=Decimal('0'), created_at=datetime(2026,7,20,11,30), paid_amount=Decimal('500'),
    remaining_amount=Decimal('680'), credit_used=None, advance_paid=None)

pdf = build_invoice_pdf(FakeDb(seller, buyer), invoice)
out_path = os.path.abspath(os.path.join('uploads', 'invoice_sample.pdf'))
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, 'wb') as fh:
    fh.write(pdf)
print(out_path)
print(os.path.exists(out_path))
