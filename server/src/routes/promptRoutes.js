/**
 * P0.2: Prompt routes — /api/prompts CRUD.
 */
import { Router } from 'express';
import {
  listPrompts,
  getPrompt,
  createPrompt,
  updatePrompt,
  deletePrompt,
} from '../controllers/promptController.js';

const router = Router();

router.get('/', listPrompts);
router.get('/:id', getPrompt);
router.post('/', createPrompt);
router.put('/:id', updatePrompt);
router.delete('/:id', deletePrompt);

export default router;
