import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useAuth } from "../use-auth";
import * as actions from "@/actions";
import * as anonTracker from "@/lib/anon-work-tracker";
import * as getProjectsAction from "@/actions/get-projects";
import * as createProjectAction from "@/actions/create-project";
import { useRouter } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: vi.fn(),
  clearAnonWork: vi.fn(),
}));

vi.mock("@/actions/get-projects", () => ({
  getProjects: vi.fn(),
}));

vi.mock("@/actions/create-project", () => ({
  createProject: vi.fn(),
}));

describe("useAuth", () => {
  const mockPush = vi.fn();
  const mockRouter = {
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as any).mockReturnValue(mockRouter);
  });

  afterEach(() => {
    cleanup();
  });

  describe("signIn", () => {
    test("successfully signs in and redirects to existing anonymous work", async () => {
      const mockAnonWork = {
        messages: [{ id: "1", role: "user", content: "Hello" }],
        fileSystemData: { "/App.jsx": { type: "file", content: "test" } },
      };

      const mockProject = { id: "anon-project-123" };

      (actions.signIn as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(mockAnonWork);
      (createProjectAction.createProject as any).mockResolvedValue(mockProject);

      const { result } = renderHook(() => useAuth());

      expect(result.current.isLoading).toBe(false);

      const response = await result.current.signIn("test@example.com", "password123");

      expect(actions.signIn).toHaveBeenCalledWith("test@example.com", "password123");
      expect(anonTracker.getAnonWorkData).toHaveBeenCalled();
      expect(createProjectAction.createProject).toHaveBeenCalledWith({
        name: expect.stringContaining("Design from"),
        messages: mockAnonWork.messages,
        data: mockAnonWork.fileSystemData,
      });
      expect(anonTracker.clearAnonWork).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/anon-project-123");
      expect(response).toEqual({ success: true });
      expect(result.current.isLoading).toBe(false);
    });

    test("successfully signs in and redirects to most recent project", async () => {
      const mockProjects = [
        { id: "project-1", name: "Project 1" },
        { id: "project-2", name: "Project 2" },
      ];

      (actions.signIn as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue(mockProjects);

      const { result } = renderHook(() => useAuth());

      const response = await result.current.signIn("test@example.com", "password123");

      expect(actions.signIn).toHaveBeenCalledWith("test@example.com", "password123");
      expect(anonTracker.getAnonWorkData).toHaveBeenCalled();
      expect(getProjectsAction.getProjects).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/project-1");
      expect(response).toEqual({ success: true });
      expect(result.current.isLoading).toBe(false);
    });

    test("successfully signs in and creates new project when no projects exist", async () => {
      const mockNewProject = { id: "new-project-456" };

      (actions.signIn as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue([]);
      (createProjectAction.createProject as any).mockResolvedValue(mockNewProject);

      const { result } = renderHook(() => useAuth());

      const response = await result.current.signIn("test@example.com", "password123");

      expect(actions.signIn).toHaveBeenCalledWith("test@example.com", "password123");
      expect(getProjectsAction.getProjects).toHaveBeenCalled();
      expect(createProjectAction.createProject).toHaveBeenCalledWith({
        name: expect.stringMatching(/New Design #\d+/),
        messages: [],
        data: {},
      });
      expect(mockPush).toHaveBeenCalledWith("/new-project-456");
      expect(response).toEqual({ success: true });
      expect(result.current.isLoading).toBe(false);
    });

    test("handles sign in failure and does not redirect", async () => {
      (actions.signIn as any).mockResolvedValue({
        success: false,
        error: "Invalid credentials",
      });

      const { result } = renderHook(() => useAuth());

      const response = await result.current.signIn("test@example.com", "wrongpassword");

      expect(actions.signIn).toHaveBeenCalledWith("test@example.com", "wrongpassword");
      expect(mockPush).not.toHaveBeenCalled();
      expect(response).toEqual({
        success: false,
        error: "Invalid credentials",
      });
      expect(result.current.isLoading).toBe(false);
    });

    test("handles anonymous work with empty messages array", async () => {
      const mockAnonWorkEmpty = {
        messages: [],
        fileSystemData: {},
      };

      const mockProjects = [{ id: "project-1", name: "Project 1" }];

      (actions.signIn as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(mockAnonWorkEmpty);
      (getProjectsAction.getProjects as any).mockResolvedValue(mockProjects);

      const { result } = renderHook(() => useAuth());

      await result.current.signIn("test@example.com", "password123");

      expect(anonTracker.getAnonWorkData).toHaveBeenCalled();
      expect(createProjectAction.createProject).not.toHaveBeenCalled();
      expect(getProjectsAction.getProjects).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/project-1");
    });

    test("sets loading state correctly during sign in", async () => {
      let resolveSignIn: (value: any) => void;
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve;
      });

      (actions.signIn as any).mockReturnValue(signInPromise);
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue([{ id: "project-1" }]);

      const { result } = renderHook(() => useAuth());

      expect(result.current.isLoading).toBe(false);

      const authPromise = result.current.signIn("test@example.com", "password123");

      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      resolveSignIn!({ success: true });
      await authPromise;

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    test("resets loading state even when sign in throws error", async () => {
      (actions.signIn as any).mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useAuth());

      await expect(result.current.signIn("test@example.com", "password123")).rejects.toThrow(
        "Network error"
      );

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("signUp", () => {
    test("successfully signs up and redirects to existing anonymous work", async () => {
      const mockAnonWork = {
        messages: [{ id: "1", role: "user", content: "Create a button" }],
        fileSystemData: { "/App.jsx": { type: "file", content: "export default () => <div/>" } },
      };

      const mockProject = { id: "anon-project-789" };

      (actions.signUp as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(mockAnonWork);
      (createProjectAction.createProject as any).mockResolvedValue(mockProject);

      const { result } = renderHook(() => useAuth());

      const response = await result.current.signUp("newuser@example.com", "password123");

      expect(actions.signUp).toHaveBeenCalledWith("newuser@example.com", "password123");
      expect(anonTracker.getAnonWorkData).toHaveBeenCalled();
      expect(createProjectAction.createProject).toHaveBeenCalledWith({
        name: expect.stringContaining("Design from"),
        messages: mockAnonWork.messages,
        data: mockAnonWork.fileSystemData,
      });
      expect(anonTracker.clearAnonWork).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/anon-project-789");
      expect(response).toEqual({ success: true });
      expect(result.current.isLoading).toBe(false);
    });

    test("successfully signs up and redirects to most recent project", async () => {
      const mockProjects = [
        { id: "project-5", name: "Project 5" },
        { id: "project-6", name: "Project 6" },
      ];

      (actions.signUp as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue(mockProjects);

      const { result } = renderHook(() => useAuth());

      const response = await result.current.signUp("newuser@example.com", "password123");

      expect(actions.signUp).toHaveBeenCalledWith("newuser@example.com", "password123");
      expect(getProjectsAction.getProjects).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/project-5");
      expect(response).toEqual({ success: true });
      expect(result.current.isLoading).toBe(false);
    });

    test("successfully signs up and creates new project when no projects exist", async () => {
      const mockNewProject = { id: "new-project-999" };

      (actions.signUp as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue([]);
      (createProjectAction.createProject as any).mockResolvedValue(mockNewProject);

      const { result } = renderHook(() => useAuth());

      const response = await result.current.signUp("newuser@example.com", "password123");

      expect(actions.signUp).toHaveBeenCalledWith("newuser@example.com", "password123");
      expect(createProjectAction.createProject).toHaveBeenCalledWith({
        name: expect.stringMatching(/New Design #\d+/),
        messages: [],
        data: {},
      });
      expect(mockPush).toHaveBeenCalledWith("/new-project-999");
      expect(response).toEqual({ success: true });
      expect(result.current.isLoading).toBe(false);
    });

    test("handles sign up failure and does not redirect", async () => {
      (actions.signUp as any).mockResolvedValue({
        success: false,
        error: "Email already registered",
      });

      const { result } = renderHook(() => useAuth());

      const response = await result.current.signUp("existing@example.com", "password123");

      expect(actions.signUp).toHaveBeenCalledWith("existing@example.com", "password123");
      expect(mockPush).not.toHaveBeenCalled();
      expect(response).toEqual({
        success: false,
        error: "Email already registered",
      });
      expect(result.current.isLoading).toBe(false);
    });

    test("sets loading state correctly during sign up", async () => {
      let resolveSignUp: (value: any) => void;
      const signUpPromise = new Promise((resolve) => {
        resolveSignUp = resolve;
      });

      (actions.signUp as any).mockReturnValue(signUpPromise);
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue([{ id: "project-1" }]);

      const { result } = renderHook(() => useAuth());

      expect(result.current.isLoading).toBe(false);

      const authPromise = result.current.signUp("newuser@example.com", "password123");

      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      resolveSignUp!({ success: true });
      await authPromise;

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    test("resets loading state even when sign up throws error", async () => {
      (actions.signUp as any).mockRejectedValue(new Error("Server error"));

      const { result } = renderHook(() => useAuth());

      await expect(
        result.current.signUp("newuser@example.com", "password123")
      ).rejects.toThrow("Server error");

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("handles null return value from getAnonWorkData", async () => {
      const mockProjects = [{ id: "project-1", name: "Project 1" }];

      (actions.signIn as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue(mockProjects);

      const { result } = renderHook(() => useAuth());

      await result.current.signIn("test@example.com", "password123");

      expect(anonTracker.getAnonWorkData).toHaveBeenCalled();
      expect(createProjectAction.createProject).not.toHaveBeenCalled();
      expect(getProjectsAction.getProjects).toHaveBeenCalled();
    });

    test("creates project name with timestamp for anonymous work", async () => {
      const mockAnonWork = {
        messages: [{ id: "1", role: "user", content: "Test" }],
        fileSystemData: {},
      };

      const mockProject = { id: "test-project" };

      (actions.signIn as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(mockAnonWork);
      (createProjectAction.createProject as any).mockResolvedValue(mockProject);

      const { result } = renderHook(() => useAuth());

      await result.current.signIn("test@example.com", "password123");

      expect(createProjectAction.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringMatching(/Design from \d{1,2}:\d{2}:\d{2}/),
        })
      );
    });

    test("creates project name with random number when no projects exist", async () => {
      (actions.signUp as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue([]);
      (createProjectAction.createProject as any).mockResolvedValue({ id: "new-project" });

      const { result } = renderHook(() => useAuth());

      await result.current.signUp("test@example.com", "password123");

      expect(createProjectAction.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringMatching(/New Design #\d+/),
        })
      );
    });

    test("handles concurrent sign in calls", async () => {
      const mockProjects = [{ id: "project-1" }];

      (actions.signIn as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue(mockProjects);

      const { result } = renderHook(() => useAuth());

      const promise1 = result.current.signIn("test@example.com", "password123");
      const promise2 = result.current.signIn("test@example.com", "password123");

      const [response1, response2] = await Promise.all([promise1, promise2]);

      expect(response1).toEqual({ success: true });
      expect(response2).toEqual({ success: true });
      expect(result.current.isLoading).toBe(false);
    });

    test("does not call clearAnonWork if no anonymous work exists", async () => {
      const mockProjects = [{ id: "project-1" }];

      (actions.signIn as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue(mockProjects);

      const { result } = renderHook(() => useAuth());

      await result.current.signIn("test@example.com", "password123");

      expect(anonTracker.clearAnonWork).not.toHaveBeenCalled();
    });

    test("handles post-sign-in errors gracefully", async () => {
      (actions.signIn as any).mockResolvedValue({ success: true });
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockRejectedValue(new Error("Database error"));

      const { result } = renderHook(() => useAuth());

      await expect(result.current.signIn("test@example.com", "password123")).rejects.toThrow(
        "Database error"
      );

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("hook return values", () => {
    test("returns correct initial state", () => {
      const { result } = renderHook(() => useAuth());

      expect(result.current).toHaveProperty("signIn");
      expect(result.current).toHaveProperty("signUp");
      expect(result.current).toHaveProperty("isLoading");
      expect(typeof result.current.signIn).toBe("function");
      expect(typeof result.current.signUp).toBe("function");
      expect(result.current.isLoading).toBe(false);
    });

    test("signIn and signUp are callable functions", () => {
      const { result } = renderHook(() => useAuth());

      expect(typeof result.current.signIn).toBe("function");
      expect(typeof result.current.signUp).toBe("function");
      expect(result.current.signIn.length).toBe(2);
      expect(result.current.signUp.length).toBe(2);
    });
  });
});
