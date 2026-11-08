export function greet(name: string): string {
    return `Hello, ${name}!`;
}

export class UserService {
    private users: string[] = [];
    
    addUser(name: string): void {
        this.users.push(name);
    }
    
    getUsers(): string[] {
        return [...this.users];
    }
}