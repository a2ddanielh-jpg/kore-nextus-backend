import { Request, Response, NextFunction } from 'express';
export interface AuthRequest extends Request {
    user?: {
        sub: string;
        email: string;
        role: string;
    };
}
export declare function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=auth.d.ts.map