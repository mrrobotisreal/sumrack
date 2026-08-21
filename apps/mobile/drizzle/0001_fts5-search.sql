-- Custom migration: FTS5 search over tokens (lemma/text), notes (title/body),
-- and journal_entries (ru). Hand-written — drizzle-kit cannot model virtual
-- tables or triggers.
--
-- Tokenizer decision (T03): `unicode61` handles Cyrillic fine (full Unicode
-- case folding at tokenization), but its `remove_diacritics` option is
-- Latin-only and does NOT fold ё→е (verified empirically). ё/е tolerance is
-- therefore achieved by indexing normalized shadow text instead:
--   - tokens_fts indexes tokens.lemma_norm / tokens.text_norm (already
--     ё-folded + lowercased by the importer in JS);
--   - notes_fts / journal_fts fold ё→е in the triggers with replace();
--   - query strings are normalized the same way in the repositories.
-- Stored content text is never mutated (roadmap §3): ё lives on in the
-- content/user tables; only the search index is folded.
--
-- Each FTS table mirrors its content table's rowid so triggers can delete by
-- rowid; the FTS tables are standalone (no content= option) because the
-- indexed text intentionally differs from the stored text.
CREATE VIRTUAL TABLE `tokens_fts` USING fts5(`lemma`, `text`, tokenize = 'unicode61');
--> statement-breakpoint
CREATE TRIGGER `tokens_fts_ai` AFTER INSERT ON `tokens` BEGIN
  INSERT INTO `tokens_fts`(rowid, `lemma`, `text`)
  VALUES (new.rowid, new.`lemma_norm`, new.`text_norm`);
END;
--> statement-breakpoint
CREATE TRIGGER `tokens_fts_ad` AFTER DELETE ON `tokens` BEGIN
  DELETE FROM `tokens_fts` WHERE rowid = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `tokens_fts_au` AFTER UPDATE ON `tokens` BEGIN
  DELETE FROM `tokens_fts` WHERE rowid = old.rowid;
  INSERT INTO `tokens_fts`(rowid, `lemma`, `text`)
  VALUES (new.rowid, new.`lemma_norm`, new.`text_norm`);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `notes_fts` USING fts5(`title`, `body`, tokenize = 'unicode61');
--> statement-breakpoint
CREATE TRIGGER `notes_fts_ai` AFTER INSERT ON `notes` BEGIN
  INSERT INTO `notes_fts`(rowid, `title`, `body`)
  VALUES (new.rowid, replace(replace(new.`title`, 'ё', 'е'), 'Ё', 'Е'), replace(replace(new.`body`, 'ё', 'е'), 'Ё', 'Е'));
END;
--> statement-breakpoint
CREATE TRIGGER `notes_fts_ad` AFTER DELETE ON `notes` BEGIN
  DELETE FROM `notes_fts` WHERE rowid = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `notes_fts_au` AFTER UPDATE ON `notes` BEGIN
  DELETE FROM `notes_fts` WHERE rowid = old.rowid;
  INSERT INTO `notes_fts`(rowid, `title`, `body`)
  VALUES (new.rowid, replace(replace(new.`title`, 'ё', 'е'), 'Ё', 'Е'), replace(replace(new.`body`, 'ё', 'е'), 'Ё', 'Е'));
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `journal_fts` USING fts5(`ru`, tokenize = 'unicode61');
--> statement-breakpoint
CREATE TRIGGER `journal_fts_ai` AFTER INSERT ON `journal_entries` BEGIN
  INSERT INTO `journal_fts`(rowid, `ru`)
  VALUES (new.rowid, replace(replace(new.`ru`, 'ё', 'е'), 'Ё', 'Е'));
END;
--> statement-breakpoint
CREATE TRIGGER `journal_fts_ad` AFTER DELETE ON `journal_entries` BEGIN
  DELETE FROM `journal_fts` WHERE rowid = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `journal_fts_au` AFTER UPDATE ON `journal_entries` BEGIN
  DELETE FROM `journal_fts` WHERE rowid = old.rowid;
  INSERT INTO `journal_fts`(rowid, `ru`)
  VALUES (new.rowid, replace(replace(new.`ru`, 'ё', 'е'), 'Ё', 'Е'));
END;
