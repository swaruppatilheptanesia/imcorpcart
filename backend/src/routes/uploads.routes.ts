import { Router } from 'express';
import { imageUpload } from '../config/upload';
import * as ctrl from '../controllers/upload.controller';

const router = Router();

// multipart/form-data with a single "file" field.
router.post('/', imageUpload.single('file'), ctrl.uploadImage);

export default router;
