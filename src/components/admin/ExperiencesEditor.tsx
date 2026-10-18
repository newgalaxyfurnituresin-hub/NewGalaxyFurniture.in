import { useRef, useState, type ReactElement } from 'react';
import { adminFetch, type FieldErrors } from '@/lib/admin/client';
import { CheckboxField, NumberField, TextAreaField, TextField } from './fields';
import type { EditorialPhoto, Experiences } from '@/schemas/experiences';

interface Props {
  initial: Experiences;
  initialSha: string;
  canWrite: boolean;
}
const button = 'min-h-[44px] border border-espresso px-4 py-2 text-small disabled:opacity-50';

function PhotoFields({
  photo,
  onChange,
  prefix,
  disabled,
  errors,
}: {
  photo: EditorialPhoto;
  onChange: (photo: EditorialPhoto) => void;
  prefix: string;
  disabled: boolean;
  errors: FieldErrors;
}): ReactElement {
  return (
    <fieldset className="grid gap-3 border border-taupe p-4 sm:grid-cols-2">
      <legend className="px-1 text-small">Image and honest caption</legend>
      <TextField
        id={`${prefix}-src`}
        label="Public image path"
        value={photo.src}
        disabled={disabled}
        errors={errors[`${prefix}.src`]}
        hint="Use a public /brand/, /products/ or /img/ image. Never enter a private enquiry photo path or an external URL."
        onChange={(src) => onChange({ ...photo, src })}
      />
      <TextField
        id={`${prefix}-alt`}
        label="Image description"
        value={photo.alt}
        disabled={disabled}
        maxLength={240}
        errors={errors[`${prefix}.alt`]}
        onChange={(alt) => onChange({ ...photo, alt })}
      />
      <NumberField
        id={`${prefix}-width`}
        label="Image width (px)"
        value={photo.width}
        disabled={disabled}
        errors={errors[`${prefix}.width`]}
        onChange={(width) => onChange({ ...photo, width: width ?? 0 })}
      />
      <NumberField
        id={`${prefix}-height`}
        label="Image height (px)"
        value={photo.height}
        disabled={disabled}
        errors={errors[`${prefix}.height`]}
        onChange={(height) => onChange({ ...photo, height: height ?? 0 })}
      />
      <div className="sm:col-span-2">
        <TextField
          id={`${prefix}-caption`}
          label="Caption / image provenance"
          value={photo.caption}
          disabled={disabled}
          maxLength={240}
          errors={errors[`${prefix}.caption`]}
          onChange={(caption) => onChange({ ...photo, caption })}
        />
      </div>
    </fieldset>
  );
}

export default function ExperiencesEditor({ initial, initialSha, canWrite }: Props): ReactElement {
  const [draft, setDraft] = useState(initial);
  const [sha, setSha] = useState(initialSha);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const inFlight = useRef(false);
  const disabled = !canWrite || busy;
  const repair = draft.repair;
  function changeRepair(next: Partial<Experiences['repair']>): void {
    setDraft((current) => ({ ...current, repair: { ...current.repair, ...next } }));
  }
  async function save(): Promise<void> {
    if (inFlight.current || !canWrite) return;
    inFlight.current = true;
    setBusy(true);
    setErrors({});
    setStatus('Saving…');
    try {
      const result = await adminFetch('/api/admin/experiences', {
        method: 'PATCH',
        body: { sha, experiences: draft },
      });
      if (!result.ok) {
        const fields = Object.fromEntries(
          Object.entries(result.error.fields ?? {}).map(([key, value]) => [
            key.replace(/^experiences\./, ''),
            value,
          ]),
        );
        setErrors(fields);
        setStatus(
          result.error.message +
            (result.error.code === 'CONFLICT'
              ? ' Reload this page before saving again; your edits have not overwritten the newer version.'
              : ''),
        );
        return;
      }
      const refreshed = await adminFetch<{ experiences: Experiences; sha: string }>(
        '/api/admin/experiences',
      );
      if (refreshed.ok) {
        setDraft(refreshed.value.experiences);
        setSha(refreshed.value.sha);
        setStatus('Saved to GitHub. The public pages update after a successful website build.');
      } else {
        setStatus(
          'The save succeeded, but the new revision could not be loaded. Reload before editing again.',
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-8"
    >
      {!canWrite && (
        <p>You can view these sections. An owner is required to change site settings.</p>
      )}
      <section className="grid gap-4 border border-taupe bg-white p-4 sm:p-6">
        <h2 className="text-h3">Sofa repair landing page</h2>
        <CheckboxField
          id="repair-home"
          label="Show sofa repair on the homepage"
          checked={repair.homeEnabled}
          disabled={disabled}
          onChange={(homeEnabled) => changeRepair({ homeEnabled })}
        />
        <TextField
          id="repair-heading"
          label="Hero heading"
          value={repair.heading}
          maxLength={100}
          disabled={disabled}
          errors={errors['repair.heading']}
          onChange={(heading) => changeRepair({ heading })}
        />
        <TextAreaField
          id="repair-description"
          label="Introduction"
          value={repair.description}
          maxLength={400}
          disabled={disabled}
          errors={errors['repair.description']}
          onChange={(description) => changeRepair({ description })}
        />
        <PhotoFields
          photo={repair.hero}
          prefix="repair.hero"
          disabled={disabled}
          errors={errors}
          onChange={(hero) => changeRepair({ hero })}
        />
        <h3 className="mt-4 text-h3">Repair topics and services</h3>
        <p className="text-small text-walnut">
          Unconfirmed topics are labelled “Discuss suitability” on the website. Confirm a service
          only when the business offers it. Turning visibility off also removes it from the enquiry
          dropdown.
        </p>
        {repair.services.map((service, index) => {
          const prefix = `repair.services.${index}`;
          const update = (patch: Partial<typeof service>): void =>
            changeRepair({
              services: repair.services.map((entry, i) =>
                i === index ? { ...entry, ...patch } : entry,
              ),
            });
          return (
            <fieldset key={service.id} className="grid gap-4 border border-taupe bg-ivory p-4">
              <legend className="px-2">
                {index + 1}. {service.title}
              </legend>
              <TextField
                id={`${prefix}-title`}
                label="Title"
                value={service.title}
                maxLength={80}
                disabled={disabled}
                errors={errors[`${prefix}.title`]}
                onChange={(title) => update({ title })}
              />
              <TextAreaField
                id={`${prefix}-description`}
                label="Description"
                value={service.description}
                maxLength={400}
                disabled={disabled}
                errors={errors[`${prefix}.description`]}
                onChange={(description) => update({ description })}
              />
              <CheckboxField
                id={`${prefix}-enabled`}
                label="Visible on the repair page"
                checked={service.enabled}
                disabled={disabled}
                onChange={(enabled) => update({ enabled })}
              />
              <CheckboxField
                id={`${prefix}-confirmed`}
                label="The business has confirmed this service is offered"
                checked={service.confirmed}
                disabled={disabled}
                onChange={(confirmed) => update({ confirmed })}
              />
              <PhotoFields
                photo={service.photo}
                prefix={`${prefix}.photo`}
                disabled={disabled}
                errors={errors}
                onChange={(photo) => update({ photo })}
              />
              {canWrite && (
                <button
                  type="button"
                  className={`${button} justify-self-start`}
                  disabled={busy}
                  onClick={() =>
                    changeRepair({
                      services: repair.services.filter((entry) => entry.id !== service.id),
                    })
                  }
                >
                  Remove topic {index + 1}
                </button>
              )}
            </fieldset>
          );
        })}
        {canWrite && (
          <button
            type="button"
            className={`${button} justify-self-start`}
            disabled={busy || repair.services.length >= 12}
            onClick={() =>
              changeRepair({
                services: [
                  ...repair.services,
                  {
                    id: `service-${crypto.randomUUID().slice(0, 8)}`,
                    title: 'New repair topic',
                    description: 'Add the details you want customers to discuss with the team.',
                    enabled: false,
                    confirmed: false,
                    photo: repair.hero,
                  },
                ],
              })
            }
          >
            Add repair topic
          </button>
        )}
        <h3 className="mt-4 text-h3">Frequently asked questions</h3>
        {repair.faqs.map((faq, index) => (
          <fieldset key={index} className="grid gap-3 border border-taupe p-4">
            <legend className="px-1">Question {index + 1}</legend>
            <TextField
              id={`faq-${index}-question`}
              label="Question"
              value={faq.question}
              disabled={disabled}
              errors={errors[`repair.faqs.${index}.question`]}
              onChange={(question) =>
                changeRepair({
                  faqs: repair.faqs.map((entry, i) =>
                    i === index ? { ...entry, question } : entry,
                  ),
                })
              }
            />
            <TextAreaField
              id={`faq-${index}-answer`}
              label="Answer"
              value={faq.answer}
              disabled={disabled}
              errors={errors[`repair.faqs.${index}.answer`]}
              onChange={(answer) =>
                changeRepair({
                  faqs: repair.faqs.map((entry, i) => (i === index ? { ...entry, answer } : entry)),
                })
              }
            />
            {canWrite && (
              <button
                type="button"
                className={`${button} justify-self-start`}
                disabled={busy}
                onClick={() => changeRepair({ faqs: repair.faqs.filter((_, i) => i !== index) })}
              >
                Remove question {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        {canWrite && (
          <button
            type="button"
            className={`${button} justify-self-start`}
            disabled={busy || repair.faqs.length >= 12}
            onClick={() =>
              changeRepair({
                faqs: [
                  ...repair.faqs,
                  {
                    question: 'Add your question',
                    answer: 'Add a helpful answer using confirmed business information.',
                  },
                ],
              })
            }
          >
            Add FAQ
          </button>
        )}
        <h3 className="mt-4 text-h3">Genuine before-and-after projects</h3>
        <p className="text-small text-walnut">
          The gallery stays hidden until you add a project and confirm both images show the same
          genuine repair. Never use inspiration imagery as evidence of completed work.
        </p>
        {repair.projects.map((project, index) => {
          const update = (patch: Partial<typeof project>): void =>
            changeRepair({
              projects: repair.projects.map((entry, i) =>
                i === index ? { ...entry, ...patch } : entry,
              ),
            });
          return (
            <fieldset key={index} className="grid gap-4 border border-taupe p-4">
              <legend className="px-1">Project {index + 1}</legend>
              <TextField
                id={`project-${index}-title`}
                label="Project title"
                value={project.title}
                disabled={disabled}
                errors={errors[`repair.projects.${index}.title`]}
                onChange={(title) => update({ title })}
              />
              <TextAreaField
                id={`project-${index}-description`}
                label="What changed"
                value={project.description}
                disabled={disabled}
                errors={errors[`repair.projects.${index}.description`]}
                onChange={(description) => update({ description })}
              />
              <PhotoFields
                photo={project.before}
                prefix={`repair.projects.${index}.before`}
                disabled={disabled}
                errors={errors}
                onChange={(before) => update({ before })}
              />
              <PhotoFields
                photo={project.after}
                prefix={`repair.projects.${index}.after`}
                disabled={disabled}
                errors={errors}
                onChange={(after) => update({ after })}
              />
              <CheckboxField
                id={`project-${index}-confirmed`}
                label="Both images show this genuine completed project; publish it"
                checked={project.confirmed}
                disabled={disabled}
                onChange={(confirmed) => update({ confirmed })}
              />
              {canWrite && (
                <button
                  type="button"
                  className={`${button} justify-self-start`}
                  disabled={busy}
                  onClick={() =>
                    changeRepair({ projects: repair.projects.filter((_, i) => i !== index) })
                  }
                >
                  Remove project {index + 1}
                </button>
              )}
            </fieldset>
          );
        })}
        {canWrite && (
          <button
            type="button"
            className={`${button} justify-self-start`}
            disabled={busy || repair.projects.length >= 12}
            onClick={() =>
              changeRepair({
                projects: [
                  ...repair.projects,
                  {
                    title: 'New restoration project',
                    description: 'Describe only the work shown in the genuine project photographs.',
                    confirmed: false,
                    before: repair.hero,
                    after: repair.hero,
                  },
                ],
              })
            }
          >
            Add project
          </button>
        )}
      </section>
      <section className="grid gap-4 border border-taupe bg-white p-4 sm:p-6">
        <h2 className="text-h3">Mattress landing page</h2>
        <CheckboxField
          id="mattress-home"
          label="Show mattresses on the homepage"
          checked={draft.mattresses.homeEnabled}
          disabled={disabled}
          onChange={(homeEnabled) =>
            setDraft((current) => ({
              ...current,
              mattresses: { ...current.mattresses, homeEnabled },
            }))
          }
        />
        <TextField
          id="mattress-heading"
          label="Hero heading"
          value={draft.mattresses.heading}
          maxLength={100}
          disabled={disabled}
          errors={errors['mattresses.heading']}
          onChange={(heading) =>
            setDraft((current) => ({ ...current, mattresses: { ...current.mattresses, heading } }))
          }
        />
        <TextAreaField
          id="mattress-description"
          label="Introduction"
          value={draft.mattresses.description}
          maxLength={400}
          disabled={disabled}
          errors={errors['mattresses.description']}
          onChange={(description) =>
            setDraft((current) => ({
              ...current,
              mattresses: { ...current.mattresses, description },
            }))
          }
        />
        <PhotoFields
          photo={draft.mattresses.hero}
          prefix="mattresses.hero"
          disabled={disabled}
          errors={errors}
          onChange={(hero) =>
            setDraft((current) => ({ ...current, mattresses: { ...current.mattresses, hero } }))
          }
        />
        <a href="/admin/products/new" className="underline">
          Add a mattress through Products → Add Product
        </a>
      </section>
      {Object.keys(errors).length > 0 && (
        <div role="alert">
          <p>Please correct these fields:</p>
          <ul>
            {Object.entries(errors).map(([key, messages]) => (
              <li key={key}>
                {key}: {messages.join(' ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p role="status" aria-live="polite">
        {status}
      </p>
      {canWrite && (
        <button
          className={`${button} self-start bg-espresso text-ivory`}
          type="submit"
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Save experience content'}
        </button>
      )}
    </form>
  );
}
