import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router';
import AppLayout from './layout/AppLayout';
import TradingPage from './pages/trading/TradingPage';
import TestTradingPage from './pages/trading/TestTradingPage';
import { ScrollToTop } from './components/common/ScrollToTop';
import Mypage from './pages/mypage/Mypage';
import SignIn from './pages/authpage/SignIn';
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

function App() {
	useSocket();

	const ProtectedRoute = ({ children }) => {
		const navigate = useNavigate();
		const { isLoggedIn, setUserInfo, setUserPrice } = useAuthStore();

		useEffect(() => {
			if (!isLoggedIn) {
				navigate('/signin');
			} else {
				auth.myInfo((res) => {
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
			}
		}, [isLoggedIn]);

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

							{/* Others Page */}
							{/* <Route
								path="/mypage"
								element={
									<ProtectedRoute>
										<Mypage />
									</ProtectedRoute>
								}
							/> */}
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
