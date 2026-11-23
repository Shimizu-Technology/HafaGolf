import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { appRoutes } from './appRoutes';

const router = createBrowserRouter(appRoutes);

function App() {
  return <ErrorBoundary><RouterProvider router={router} /></ErrorBoundary>;
}

export default App;
