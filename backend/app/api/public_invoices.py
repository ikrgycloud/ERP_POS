from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.document_service import document_service
from app.models import Invoice
from app.public_invoice_links import verify_public_invoice_token

router = APIRouter(prefix="/public/invoices", tags=["Public Invoices"])


@router.get("/{token}/pdf")
def download_public_invoice_pdf(token: str, db: Session = Depends(get_db)) -> Response:
    verified = verify_public_invoice_token(token)
    if not verified:
        raise HTTPException(status_code=404, detail="Invoice link is invalid or expired")
    invoice_id, business_profile_id = verified
    invoice = db.get(Invoice, invoice_id)
    if not invoice or invoice.status == "Deleted" or invoice.is_reverse or invoice.business_profile_id != business_profile_id:
        raise HTTPException(status_code=404, detail="Invoice link is invalid or expired")
    filename = f"{invoice.invoice_number or invoice.id}.pdf"
    return Response(
        content=document_service.invoice_pdf(db, invoice),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
