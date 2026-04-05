import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		// port: 5174,
		host: '0.0.0.0',
		proxy: {
			'/user': {
				target: 'http://118.219.44.230:80',
				changeOrigin: true,
				secure: false
			},
			'/admin': {
				target: 'http://118.219.44.230:80',
				changeOrigin: true,
				secure: false
			}
		}
	}
});
