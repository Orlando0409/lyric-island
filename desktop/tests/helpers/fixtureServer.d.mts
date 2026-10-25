import type { Server } from 'node:http';
export declare const FIXTURES: string;
export declare function resolveFixture(url: string): { status: number; body: string };
export declare function startFixtureServer(port?: number): Promise<{ server: Server; baseUrl: string }>;
