import Dexie, { Table } from 'dexie';
import { BYOKSettings, ChatSession, Project } from '../types';

export class AppDatabase extends Dexie {
  settings!: Table<BYOKSettings, string>;
  projects!: Table<Project, string>;
  chats!: Table<ChatSession, string>;

  constructor() {
    super('AISandboxDB');
    this.version(1).stores({
      settings: 'id', // we will just use 'default' as id
      projects: 'id, name, updatedAt',
      chats: 'id, title, updatedAt'
    });
  }
}

export const db = new AppDatabase();
