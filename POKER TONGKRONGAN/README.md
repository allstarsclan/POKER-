# Poker Tongkrongan

Aplikasi web multiplayer untuk permainan kartu tongkrongan 4 pemain.

## Deploy ke Cloudflare Workers

Game memakai Cloudflare Workers untuk website, Durable Objects untuk room dan state game, serta WebSocket bawaan browser untuk multiplayer.

1. Pastikan perubahan proyek terbaru sudah di-commit dan ada di GitHub.
2. Di Cloudflare Dashboard, buka **Workers & Pages** lalu pilih **Create application → Workers → Connect to Git** (nama menu bisa sedikit berbeda).
3. Hubungkan akun GitHub dan pilih repository game.
4. Karena proyek berada di subfolder, atur **Root directory** ke `POKER TONGKRONGAN`.
5. Atur **Build command** ke `npm install` dan **Deploy command** ke `npm run deploy`.
6. Deploy Worker. `wrangler.toml` mendaftarkan aset website dan Durable Object yang dibutuhkan game.
7. Setelah deploy berhasil, buka alamat `*.workers.dev` yang ditampilkan Cloudflare dan bagikan ke teman.

Aplikasi ini tidak memerlukan proyek Supabase atau environment variable khusus. Cloudflare dapat meminta verifikasi akun atau informasi billing sesuai kebijakan akun dan layanannya; periksa biaya yang ditampilkan sebelum menyetujuinya. Jangan membagikan API token Cloudflare.

Untuk menjalankan lokal, pasang Node.js 18 atau lebih baru, jalankan `npm install`, lalu `npm start`. Wrangler akan meminta login Cloudflare saat pertama kali melakukan deploy.

## Aturan permainan

- Satu game berisi empat pemain; host dapat mengisi kursi kosong dengan bot.
- Kartu dibagikan rata dari satu deck. Pemegang 3♠ membuka permainan pertama dan kombinasi pembuka harus membawa 3♠.
- Kombinasi: single, pair, triss, polo (full house), dan bomb (empat kartu dengan angka sama).
- Pemain berikutnya harus mengalahkan kombinasi di meja dengan kombinasi sejenis. Bomb dapat mengalahkan single kartu 2; pemilik kartu 2 langsung kalah dan pemain yang mengeluarkan bomb menang.
- Pemain juga menang jika berhasil menghabiskan semua kartu lebih dulu. Pemain yang pass tidak dapat ikut lagi sampai kombinasi meja dibuka ulang.

Aturan bomb khusus mengikuti penjelasan pemilik game; perbandingan kombinasi lainnya memakai pola umum permainan Big Two.
