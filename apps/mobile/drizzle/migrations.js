// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_fts5-search.sql';
import m0002 from './0002_story-progress.sql';
import m0003 from './0003_sync-state-bytes.sql';
import m0004 from './0004_unit-progress.sql';
import m0005 from './0005_motivation.sql';
import m0006 from './0006_perf-indexes.sql';
import m0007 from './0007_bookmarks.sql';
import m0008 from './0008_dialogues.sql';
import m0009 from './0009_imports.sql';
import m0010 from './0010_path-theme-track.sql';
import m0011 from './0011_library-categories.sql';
import m0012 from './0012_review-source.sql';
import m0013 from './0013_word-profiles.sql';
import m0014 from './0014_scenarios.sql';
import m0015 from './0015_exams.sql';
import m0016 from './0016_core-lemmas.sql';
import m0017 from './0017_card-management.sql';

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
    m0005,
    m0006,
    m0007,
    m0008,
    m0009,
    m0010,
    m0011,
    m0012,
    m0013,
    m0014,
    m0015,
    m0016,
    m0017,
  },
};
