// routes — barrel qui assemble le router /api/ecg en montant les 4 sous-routes
// (data files, convert, render-image, report). server.ts importe seulement
// `ecgRouter` d'ici, sans avoir à connaître le détail des endpoints.
// Out : un Router Express prêt à être monté sur /api/ecg.

import { Router } from 'express';
import { dataFilesRouter } from './data-files.js';
import { convertRouter } from './convert.js';
import { renderImageRouter } from './render-image.js';
import { reportRouter } from './report.js';

export const ecgRouter = Router();

ecgRouter.use('/data', dataFilesRouter);
ecgRouter.use(convertRouter);
ecgRouter.use(renderImageRouter);
ecgRouter.use(reportRouter);
