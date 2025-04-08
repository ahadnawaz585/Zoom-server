import { Request, Response } from 'express';

export const health = async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
}