import { useMemo, useState } from 'react';
import { settingsHooks } from '../features/settings';
import { useToast } from '../components/Toast';
import { Page } from '../components/Shell';
import { Button, ErrorBox, Field, Input, Loading, Panel, SectionLabel } from '../components/ui';
import { ThemeSelector } from '../theme/ThemeSelector';
import {
  storeAddressLabel,
  storeBranchLabel,
  storeFromBranding,
  storeGstinLabel,
} from '../config/storeConfig';

export default function SettingsPage() {
  const toast = useToast();
  const branding = settingsHooks.useInvoiceBranding();
  const updateBranding = settingsHooks.useUpdateInvoiceBranding({
    onSuccess: (updated) => {
      setForm(updated);
      toast.ok('Invoice header saved');
    },
  });
  const [form, setForm] = useState(null);

  const values = form || branding.data || {};
  const previewStore = useMemo(() => storeFromBranding(values), [values]);

  if (branding.isLoading && !branding.data) return <Page title="Settings"><Loading /></Page>;

  async function save() {
    try {
      await updateBranding.mutateAsync({
        company_name: values.company_name || '',
      });
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Page title="Settings" subtitle="Branch Manager">
      <Panel className="mb-5 p-5">
        <SectionLabel>APPEARANCE</SectionLabel>
        <h2 className="mt-3 text-lg font-semibold text-bone">Theme</h2>
        <p className="mt-1 text-sm text-mute">Choose the appearance for this browser. It applies immediately.</p>
        <div className="mt-5"><ThemeSelector /></div>
      </Panel>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Panel className="p-5">
          {branding.error ? <ErrorBox error={branding.error} onRetry={branding.refetch} /> : null}

          <SectionLabel>INVOICE HEADER</SectionLabel>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="COMPANY NAME">
              <Input
                value={values.company_name || ''}
                maxLength={200}
                onChange={(event) =>
                  setForm({ ...values, company_name: event.target.value })
                }
              />
            </Field>
          </div>

          <div className="mt-6 flex justify-end">
            <Button className="px-5 py-2.5" loading={updateBranding.isPending} onClick={save}>
              Save Changes
            </Button>
          </div>
        </Panel>

        <Panel className="overflow-hidden p-5">
          <SectionLabel>LIVE PREVIEW</SectionLabel>
          <div className="mt-5 rounded-sm bg-receipt p-4 text-receipt-text">
            <InvoicePreview store={previewStore} />
          </div>
        </Panel>
      </div>
    </Page>
  );
}

function InvoicePreview({ store }) {
  return (
    <div className="relative overflow-hidden bg-receipt">
      <div className="relative">
        <div className="grid grid-cols-[1.25fr_0.75fr] gap-4 border border-receipt-text p-4">
          <section className="flex gap-3">
            <div>
              <h1 className="m-0 text-[22px] font-extrabold leading-tight">{store.name}</h1>
              <div className="mt-1 text-[11px] text-secondary">
                {storeBranchLabel(store) && <p>{storeBranchLabel(store)}</p>}
                {storeAddressLabel(store) && <p>{storeAddressLabel(store)}</p>}
                {storeGstinLabel(store) && <p>{storeGstinLabel(store)}</p>}
              </div>
            </div>
          </section>
          <section className="text-right font-mono text-[11px]">
            <h2 className="mb-2 text-[15px] font-extrabold uppercase">Tax Invoice</h2>
            <p><strong>Invoice:</strong> INV-PREVIEW</p>
            <p><strong>Date:</strong> 15 Jul 2026</p>
            <p><strong>Time:</strong> 18:00</p>
            <p><strong>Payment:</strong> Cash</p>
          </section>
        </div>
        <h3 className="my-3 text-[10px] font-extrabold uppercase tracking-wide">
          Purchased Products
        </h3>
        <table className="w-full border-collapse text-[10px]">
          <tbody>
            <tr>
              <td className="border border-receipt-text p-2">Product</td>
              <td className="border border-receipt-text p-2 text-right font-mono">Qty</td>
              <td className="border border-receipt-text p-2 text-right font-mono">Line Total</td>
            </tr>
            <tr>
              <td className="border border-receipt-text p-2">Preview Item</td>
              <td className="border border-receipt-text p-2 text-right font-mono">1</td>
              <td className="border border-receipt-text p-2 text-right font-mono">₹ 0.00</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
