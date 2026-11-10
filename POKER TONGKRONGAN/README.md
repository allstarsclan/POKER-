# Poker Tongkrongan

Aplikasi web multiplayer untuk permainan kartu tongkrongan 4 pemain.

Tersedia dua mode: **Poker Ronda** (kombinasi buang kartu dan aturan bomb/seri tongkrongan) dan **Texas Hold’em** (dua kartu hole, lima community cards, blind, fold/check/call/raise, dan showdown). Texas Hold’em memakai chip virtual, bukan uang sungguhan: setiap pemain mulai dengan 100.000 chip, small blind 1.000, big blind 2.000. All-in dan side pot belum didukung.

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
- Kartu dibagikan rata dari satu deck. Di awal permainan, semua kartu angka 3 dibuka dan dibuang. Pemegang 3♠ mendapat giliran pertama dan membuka permainan dengan kartu lain.
- Kombinasi: single, pair, triss, polo (full house), bomb (empat kartu dengan angka sama), dan seri minimal tiga kartu berurutan dengan daun yang sama.
- Seri yang dilawan harus memiliki jumlah kartu yang sama; seri dengan kartu tertinggi lebih besar menang. Urutan normal seri adalah 3 sampai A (2 tidak ikut). Jika bomb dimainkan sebelum ada kartu 2 yang dimainkan, 2 dapat menjadi kartu terendah tepat sebelum 3 dalam seri.
- Pemain berikutnya harus mengalahkan kombinasi di meja dengan kombinasi sejenis. Bomb dapat mengalahkan single kartu 2; pemilik kartu 2 langsung kalah dan pemain yang mengeluarkan bomb menang.
- Pemain juga menang jika berhasil menghabiskan semua kartu lebih dulu. Pemain yang pass tidak dapat ikut lagi sampai kombinasi meja dibuka ulang.

Aturan bomb khusus mengikuti penjelasan pemilik game; perbandingan kombinasi lainnya memakai pola umum permainan Big Two.
