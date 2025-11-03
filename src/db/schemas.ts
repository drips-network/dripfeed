import { createSelectSchema } from 'drizzle-zod';
import type { z } from 'zod';

import {
  projects,
  dripLists,
  ecosystemMainAccounts,
  linkedIdentities,
  subLists,
} from './schema.js';

export const projectSchema = createSelectSchema(projects);
export type Project = z.infer<typeof projectSchema>;
export type Forge = z.infer<typeof projectSchema.shape.forge>;
export type ProjectStatus = z.infer<typeof projectSchema.shape.verification_status>;

export const dripListSchema = createSelectSchema(dripLists);
export type DripList = z.infer<typeof dripListSchema>;

export const ecosystemMainAccountSchema = createSelectSchema(ecosystemMainAccounts);
export type EcosystemMainAccount = z.infer<typeof ecosystemMainAccountSchema>;

export const linkedIdentitySchema = createSelectSchema(linkedIdentities);
export type LinkedIdentity = z.infer<typeof linkedIdentitySchema>;
export type LinkedIdentityType = z.infer<typeof linkedIdentitySchema.shape.identity_type>;

export const subListSchema = createSelectSchema(subLists);
export type SubList = z.infer<typeof subListSchema>;
