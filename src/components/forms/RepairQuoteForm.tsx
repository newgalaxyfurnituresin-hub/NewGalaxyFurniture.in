import EnquiryForm, { type FallbackNumber } from './EnquiryForm';

export default function RepairQuoteForm({
  numbers,
  services,
}: {
  numbers: readonly FallbackNumber[];
  services: readonly string[];
}): React.JSX.Element {
  return (
    <EnquiryForm
      type="QUOTE"
      fields={['name', 'phone', 'message', 'image']}
      submitLabel="Send repair enquiry"
      numbers={numbers}
      repairServices={services}
      intro="Tell us what needs attention. Sending an enquiry does not book a service or commit you to a price."
      confirmationMessage="Thank you. Your repair enquiry has been recorded. The team can now discuss the options with you by phone or WhatsApp."
      fieldLabels={{
        message: {
          label: 'What would you like us to look at?',
          placeholder: 'Describe the wear, damage or changes you have in mind…',
        },
        image: { label: 'A photograph of your sofa (optional)' },
      }}
    />
  );
}
