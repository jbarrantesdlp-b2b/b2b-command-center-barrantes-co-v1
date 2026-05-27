import { sql } from './_db.js'

export default async function handler(req, res) {
  try {
    const rows = await sql`select now() as server_time`
    const server_time = rows[0]?.server_time
    return res.status(200).json({ ok: true, database: 'neon', server_time })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message })
  }
}
