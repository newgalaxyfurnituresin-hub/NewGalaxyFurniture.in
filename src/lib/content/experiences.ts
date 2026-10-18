import content from '../../../data/site/experiences.json';
import { ExperiencesSchema } from '@/schemas/experiences';

/** Build-time copy and the runtime fallback share the admin write schema. */
export const experiences = ExperiencesSchema.parse(content);
