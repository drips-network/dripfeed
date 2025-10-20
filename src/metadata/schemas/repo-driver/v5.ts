import { z } from 'zod';

import { repoDriverAccountMetadataSchemaV4 } from './v4.js';

export const repoDriverAccountMetadataSchemaV5 = repoDriverAccountMetadataSchemaV4.extend({
  isVisible: z.boolean(),
});
