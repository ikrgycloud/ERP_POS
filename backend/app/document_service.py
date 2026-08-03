"""Shared ERP document generation facade."""
from __future__ import annotations

from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from sqlalchemy.orm import Session

from app.invoice_pdf import build_invoice_pdf
from app.models import Invoice, SupplierReturn
from app.rtv_pdf import build_rtv_pdf


def _docx_bytes(lines: list[str]) -> bytes:
    escaped = [
        line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        for line in lines
    ]
    paragraphs = "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in escaped)
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{paragraphs}<w:sectPr/></w:body></w:document>"
    )
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            "</Types>",
        )
        archive.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/></Relationships>',
        )
        archive.writestr("word/document.xml", document_xml)
    return output.getvalue()


class DocumentService:
    def invoice_pdf(self, db: Session, invoice: Invoice) -> bytes:
        return build_invoice_pdf(db, invoice)

    def supplier_return_pdf(self, db: Session, supplier_return: SupplierReturn) -> bytes:
        return build_rtv_pdf(db, supplier_return)

    def invoice_docx(self, invoice: Invoice) -> bytes:
        return _docx_bytes(
            [
                f"Tax Invoice {invoice.invoice_number or invoice.id}",
                f"Party: {invoice.party_name}",
                f"Date: {invoice.date}",
                f"Due Date: {invoice.due_date}",
                f"Status: {invoice.status}",
            ]
        )

    def supplier_return_docx(self, supplier_return: SupplierReturn) -> bytes:
        return _docx_bytes(
            [
                f"Return To Vendor {supplier_return.rtv_number or supplier_return.id}",
                f"Reason: {supplier_return.reason or '-'}",
                f"Shipment Status: {supplier_return.shipment_status}",
                f"Remarks: {supplier_return.remarks or '-'}",
            ]
        )


document_service = DocumentService()
