import type { MetadataService } from '../services/MetadataService.js';

import type { ProjectsRepository } from './ProjectsRepository.js';
import type { DeadlinesRepository } from './DeadlinesRepository.js';

/**
 * Container for all repositories and services available to event handlers.
 */
export class Services {
  readonly metadataService: MetadataService;
  readonly projects: ProjectsRepository;
  readonly deadlines: DeadlinesRepository;

  constructor(
    projects: ProjectsRepository,
    deadlines: DeadlinesRepository,
    metadataService: MetadataService,
  ) {
    this.projects = projects;
    this.deadlines = deadlines;
    this.metadataService = metadataService;
  }
}
