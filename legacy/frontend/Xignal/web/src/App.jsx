import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router';
import AppLayout from './layout/AppLayout';
import TradingPage from './pages/trading/TradingPage';
import TestTradingPage from './pages/trading/TestTradingPage';
import { ScrollToTop } from './components/common/ScrollToTop';
import Mypage from './pages/mypage/Mypage';
import SignIn from './pages/authpage/SignIn';
import AdminSignIn from './pages/authpage/AdminSignIn';
import SignUp from './pages/authpage/SignUp';
import ForgotPassword from './pages/authpage/ForgotPassword.jsx';
import { useAuthStore } from './store/authState';
import { auth } from './services/auth';
import { MessageModalProvider } from './providers/MessageModalProvider.jsx';
import TradeHistoryPage from './pages/tradingHistory/TradeHistoryPage.jsx';
import TestTradeHistoryPage from './pages/tradingHistory/TestTradeHistoryPage.jsx';
import { useSocket } from './hooks/useSocket';
import TradeHistoryDetailPage from './pages/tradingHistory/TradeHistoryDetailPage.jsx';
import TestTradeHistoryDetailPage from './pages/tradingHistory/TestTradeHistoryDetailPage.jsx';
import SignUpComplete from './pages/authpage/SignUpComplete.jsx';
import AdminConsole from './pages/admin/AdminConsole.jsx';
import { clearSessionAuth, getSessionSnapshot } from './utils/sessionAuth.js';

function App() {
	useSocket();

	const ProtectedRoute = ({ children }) => {
		const navigate = useNavigate();
		const { hydrateSessionState, setIsAdminSession, setIsLoggedIn, setUserInfo, setUserPrice } = useAuthStore();

		useEffect(() => {
			const session = getSessionSnapshot('user');
			hydrateSessionState('user');

			if (!session.isLoggedIn) {
				clearSessionAuth('user');
				setIsLoggedIn(false);
				setIsAdminSession(false);
				navigate('/signin');
			} else {
				auth.member((res) => {
					if (!res || res.errors) {
						clearSessionAuth('user');
						setIsLoggedIn(false);
						setIsAdminSession(false);
						navigate('/signin');
						return;
					}

					setUserInfo({
						loginId: res.mem_id,
						username: res.mem_name,
						grade: res.grade,
						livePrice: res.live_price,
						paperPrice: res.price
					});
					setUserPrice({
						livePrice: res.live_price,
						paperPrice: res.price
					});
					setIsLoggedIn(true);
					setIsAdminSession(false);
				});
			}
		}, [hydrateSessionState, navigate, setIsAdminSession, setIsLoggedIn, setUserInfo, setUserPrice]);

		return children;
	};

	const AdminProtectedRoute = ({ children }) => {
		const navigate = useNavigate();
		const { hydrateSessionState, setIsLoggedIn, setIsAdminSession, setUserInfo, setUserPrice } = useAuthStore();

		useEffect(() => {
			const session = getSessionSnapshot('admin');
			hydrateSessionState('admin');

			if (!session.isLoggedIn || !session.isAdminSession) {
				setIsLoggedIn(false);
				setIsAdminSession(false);
				navigate('/ops-signin');
				return;
			}

			auth.myInfo((res) => {
				if (!res || Number(res.grade) > 0) {
					clearSessionAuth('admin');
					setIsLoggedIn(false);
					setIsAdminSession(false);
					navigate('/ops-signin');
					return;
				}

				setIsLoggedIn(true);
				setIsAdminSession(true);
				setUserInfo({
					loginId: res.mem_id,
					username: res.mem_name,
					grade: res.grade,
					livePrice: res.live_price,
					paperPrice: res.price
				});
				setUserPrice({
					livePrice: res.live_price,
					paperPrice: res.price
				});
			});
		}, [hydrateSessionState, navigate, setIsAdminSession, setIsLoggedIn, setUserInfo, setUserPrice]);

		return children;
	};

	return (
		<>
			<MessageModalProvider>
				<Router>
					<ScrollToTop />
					<Routes>
						{/* Dashboard Layout */}
						<Route
							path="/signin"
							element={
								<>
									<SignIn />
								</>
							}
						/>
						<Route
							path="/ops-signin"
							element={
								<>
									<AdminSignIn />
								</>
							}
						/>
						<Route
							path="/forgot-password"
							element={
								<>
									<ForgotPassword />
								</>
							}
						/>
						<Route
							path="/signup"
							element={
								<>
									<SignUp />
								</>
							}
						/>
						<Route
							path="/signup/complete"
							element={
								<>
									<SignUpComplete />
								</>
							}
						/>
						<Route element={<AppLayout />}>
							<Route
								path="/"
								element={
									<ProtectedRoute>
										<TradingPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/test"
								element={
									<ProtectedRoute>
										<TestTradingPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/trade-history"
								element={
									<ProtectedRoute>
										<TradeHistoryPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/trade-history/:id"
								element={
									<ProtectedRoute>
										<TradeHistoryDetailPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/test/trade-history"
								element={
									<ProtectedRoute>
										<TestTradeHistoryPage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/test/trade-history/:id"
								element={
									<ProtectedRoute>
										<TestTradeHistoryDetailPage />
									</ProtectedRoute>
								}
							/>

							<Route
								path="/mypage"
								element={
									<ProtectedRoute>
										<Mypage />
									</ProtectedRoute>
								}
							/>
							<Route
								path="/ops-console"
								element={
									<AdminProtectedRoute>
										<AdminConsole />
									</AdminProtectedRoute>
								}
							/>
						</Route>

						{/* Auth Layout */}
						{/* <Route path="/signin" element={<SignIn />} /> */}
					</Routes>
				</Router>
			</MessageModalProvider>
		</>
	);
}

export default App;
