import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, Image as ImageIcon } from 'lucide-react';
import { PublicReturnEvidence } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { dateStr } from '../lib/format';
import { Button, ErrorBox, Input, Loading, Panel, Pill } from '../components/ui';

const FALLBACK_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function fileSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PublicReturnEvidencePage() {
  const { token } = useParams();
  const info = useAsync(() => PublicReturnEvidence.info(token), [token]);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(null);
  const [error, setError] = useState(null);
  const [fileError, setFileError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const maxBytes = info.data?.max_upload_bytes || FALLBACK_MAX_UPLOAD_BYTES;
  const maxLabel = useMemo(() => fileSize(maxBytes), [maxBytes]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function selectFile(nextFile) {
    setError(null);
    setUploaded(null);
    setFile(null);
    setFileError('');
    if (!nextFile) return;
    if (!ACCEPTED_TYPES.includes(nextFile.type)) {
      setFileError('Upload a JPG, PNG, or WEBP photo.');
      return;
    }
    if (nextFile.size > maxBytes) {
      setFileError(`This photo is ${fileSize(nextFile.size)}. Please upload an image up to ${maxLabel}.`);
      return;
    }
    setFile(nextFile);
  }

  function closePage() {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) {
        window.location.replace('about:blank');
      }
    }, 300);
  }

  async function submit(event) {
    event.preventDefault();
    if (!file || fileError) return;
    setBusy(true);
    setError(null);
    try {
      const result = await PublicReturnEvidence.upload(token, file, note.trim());
      setUploaded(result);
      setFile(null);
      setNote('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-ground px-4 py-8 text-bone">
      <div className="mx-auto max-w-md space-y-4">
        <Panel className="p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
              RETURN EVIDENCE
            </p>
            {info.data ? <Pill tone="info">{info.data.status}</Pill> : null}
          </div>
          {info.loading ? <Loading label="Checking upload link..." /> : null}
          {info.error ? <ErrorBox error={info.error} onRetry={info.reload} /> : null}
          {info.data && uploaded ? (
            <SuccessState
              returnNumber={info.data.return_number}
              uploaded={uploaded}
              onClose={closePage}
            />
          ) : null}
          {info.data && !uploaded ? (
            <>
              <h1 className="mt-3 text-xl font-semibold text-bone">
                {info.data.return_number}
              </h1>
              <p className="mt-1 text-[12px] text-mute">
                Status {info.data.status} · Link expires {dateStr(info.data.expires_at)}
              </p>
              <div className="mt-4 rounded-ctl border border-info/30 bg-info/10 px-4 py-3">
                <p className="text-[13px] font-medium text-info">Upload one clear damage photo</p>
                <p className="mt-1 text-[11px] leading-relaxed text-mute">
                  JPG, PNG, or WEBP accepted. Maximum size {maxLabel}. Use the phone camera's normal photo mode.
                </p>
              </div>
              <form onSubmit={submit} className="mt-5 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="py-3 text-[12px]"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="h-4 w-4" />
                    Camera
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="py-3 text-[12px]"
                    onClick={() => galleryInputRef.current?.click()}
                  >
                    <ImageIcon className="h-4 w-4" />
                    Gallery
                  </Button>
                </div>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(',')}
                  capture="environment"
                  className="hidden"
                  onChange={(event) => selectFile(event.target.files?.[0] || null)}
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(',')}
                  className="hidden"
                  onChange={(event) => selectFile(event.target.files?.[0] || null)}
                />
                {file ? (
                  <div className="overflow-hidden rounded-ctl border border-hair bg-raised">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt=""
                        className="h-52 w-full bg-ground object-contain"
                      />
                    ) : null}
                    <div className="px-4 py-3">
                      <p className="truncate text-[13px] font-medium text-bone">{file.name}</p>
                      <p className="mt-1 text-[11px] text-mute">{fileSize(file.size)} · ready to upload</p>
                    </div>
                  </div>
                ) : null}
                {fileError ? (
                  <div className="rounded-ctl border border-amber/40 bg-amber/10 px-4 py-3 text-[12px] leading-relaxed text-amber">
                    {fileError}
                  </div>
                ) : null}
                <Input
                  placeholder="Optional note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={180}
                />
                {error ? <ErrorBox error={error} /> : null}
                <Button type="submit" loading={busy} disabled={!file} className="w-full py-3">
                  Upload Photo
                </Button>
              </form>
            </>
          ) : null}
        </Panel>
      </div>
    </main>
  );
}

function SuccessState({ returnNumber, uploaded, onClose }) {
  return (
    <div className="pt-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-ok/50 bg-ok/10 text-2xl font-semibold text-ok">
        ✓
      </div>
      <h1 className="mt-5 text-xl font-semibold text-bone">Uploaded successfully</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-mute">
        The evidence photo has been attached to return {returnNumber}. The store team can continue the approval process.
      </p>
      <div className="mt-5 rounded-ctl border border-hair bg-raised px-4 py-3 text-left">
        <p className="truncate text-[13px] font-medium text-bone">{uploaded.original_name}</p>
        <p className="mt-1 text-[11px] text-mute">{fileSize(uploaded.file_size)} received</p>
      </div>
      <Button type="button" className="mt-6 w-full py-3" onClick={onClose}>
        Close Page
      </Button>
      <p className="mt-3 text-[11px] text-mute">
        If the page stays open, you can safely close this browser tab.
      </p>
    </div>
  );
}
