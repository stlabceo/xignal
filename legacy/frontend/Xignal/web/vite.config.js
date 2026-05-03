import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const apiTarget = env.VITE_API_URL || 'http://127.0.0.1:3000';

	return {
		plugins: [react(), tailwindcss()],
		server: {
			host: '0.0.0.0',
			proxy: {
				'/user': {
					target: apiTarget,
					changeOrigin: true,
					secure: false
				},
				'/admin': {
					target: apiTarget,
					changeOrigin: true,
					secure: false
				}
			}
		}
	};
});
