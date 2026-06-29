import { Pool } from 'pg';
export declare const pool: Pool;
export declare const db: {
    prepare: (sql: string) => {
        get: (...params: any[]) => Promise<any>;
        all: (...params: any[]) => Promise<any[]>;
        run: (...params: any[]) => Promise<void>;
    };
};
export declare function initDatabase(): Promise<void>;
//# sourceMappingURL=database.d.ts.map